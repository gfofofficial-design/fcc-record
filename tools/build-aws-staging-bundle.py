#!/usr/bin/env python3
"""Build a deterministic, commit-bound Lambda archive for FCC staging."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import subprocess
import sys
import tempfile
import zipfile


RUNTIME_FILES = (
    "package.json",
    "package-lock.json",
    "tools/aws-staging-intake.js",
    "tools/lib/aws-staging-intake.js",
    "tools/lib/ulid.js",
)
FIXED_ZIP_TIME = (1980, 1, 1, 0, 0, 0)


class BundleError(RuntimeError):
    pass


def run_git(root: Path, *args: str) -> str:
    result = subprocess.run(
        ["git", *args], cwd=root, text=True, capture_output=True, check=False
    )
    if result.returncode:
        detail = result.stderr.strip() or result.stdout.strip()
        raise BundleError(f"git {' '.join(args)} failed: {detail}")
    return result.stdout.strip()


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def require_clean_commit(root: Path) -> str:
    commit = run_git(root, "rev-parse", "HEAD")
    if len(commit) != 40 or any(char not in "0123456789abcdef" for char in commit):
        raise BundleError("HEAD did not resolve to a full lowercase commit SHA")
    dirty = run_git(root, "status", "--porcelain=v1", "--untracked-files=all")
    if dirty:
        raise BundleError("refusing to package a dirty checkout; commit or remove changes first")
    return commit


def runtime_dependencies(root: Path) -> list[str]:
    package_path = root / "package.json"
    try:
        package = json.loads(package_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise BundleError(f"cannot read package.json: {exc}") from exc
    dependencies = package.get("dependencies")
    if not isinstance(dependencies, dict) or not dependencies:
        raise BundleError("package.json must declare runtime dependencies")
    names = sorted(dependencies)
    for name in names:
        installed = root / "node_modules" / Path(*name.split("/"))
        if not installed.is_dir():
            raise BundleError(f"runtime dependency is not installed: {name}; run npm ci")
    return names


def collect_files(root: Path) -> list[tuple[str, Path]]:
    selected: list[tuple[str, Path]] = []
    for relative in RUNTIME_FILES:
        source = root / relative
        if not source.is_file():
            raise BundleError(f"required runtime file is missing: {relative}")
        selected.append((PurePosixPath(relative).as_posix(), source))

    modules = root / "node_modules"
    if not modules.is_dir():
        raise BundleError("node_modules is missing; run npm ci")
    for directory, names, files in os.walk(modules, followlinks=False):
        current = Path(directory)
        relative_dir = current.relative_to(root)
        names[:] = sorted(
            name for name in names
            if name not in {".bin", ".cache"} and not (current / name).is_symlink()
        )
        for name in sorted(files):
            source = current / name
            if source.is_symlink() or not source.is_file():
                continue
            relative = PurePosixPath(*source.relative_to(root).parts).as_posix()
            selected.append((relative, source))

    selected.sort(key=lambda item: item[0])
    if len({relative for relative, _ in selected}) != len(selected):
        raise BundleError("duplicate archive paths detected")
    return selected


def write_archive(target: Path, files: list[tuple[str, Path]]) -> tuple[str, int]:
    target.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile(dir=target.parent, suffix=".zip", delete=False) as handle:
        temporary = Path(handle.name)
    try:
        with zipfile.ZipFile(
            temporary, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=9
        ) as archive:
            for relative, source in files:
                data = source.read_bytes()
                info = zipfile.ZipInfo(relative, FIXED_ZIP_TIME)
                info.create_system = 3
                info.external_attr = 0o100644 << 16
                info.compress_type = zipfile.ZIP_DEFLATED
                archive.writestr(info, data, compress_type=zipfile.ZIP_DEFLATED, compresslevel=9)
        archive_bytes = temporary.read_bytes()
        digest = sha256(archive_bytes)
        if target.exists():
            if target.read_bytes() != archive_bytes:
                raise BundleError(f"refusing to overwrite a different archive: {target}")
            temporary.unlink()
        else:
            os.replace(temporary, target)
        return digest, sum(source.stat().st_size for _, source in files)
    finally:
        if temporary.exists():
            temporary.unlink()


def write_manifest(target: Path, manifest: dict) -> None:
    data = (json.dumps(manifest, indent=2, sort_keys=True) + "\n").encode("utf-8")
    if target.exists():
        if target.read_bytes() != data:
            raise BundleError(f"refusing to overwrite a different manifest: {target}")
        return
    target.write_bytes(data)


def build(root: Path, output_dir: Path) -> dict:
    root = root.resolve()
    if not output_dir.is_absolute():
        output_dir = root / output_dir
    commit = require_clean_commit(root)
    dependencies = runtime_dependencies(root)
    files = collect_files(root)
    archive_name = f"fcc-staging-lambda-{commit}.zip"
    archive_path = output_dir.resolve() / archive_name
    archive_digest, uncompressed_bytes = write_archive(archive_path, files)
    lock_digest = sha256((root / "package-lock.json").read_bytes())
    manifest = {
        "archive": archive_name,
        "archiveSha256": archive_digest,
        "commitSha": commit,
        "environment": "staging",
        "fileCount": len(files),
        "packageLockSha256": lock_digest,
        "runtimeDependencies": dependencies,
        "schemaVersion": 1,
        "uncompressedBytes": uncompressed_bytes,
    }
    manifest_path = archive_path.with_suffix(".manifest.json")
    write_manifest(manifest_path, manifest)
    return {
        **manifest,
        "archivePath": str(archive_path),
        "manifestPath": str(manifest_path),
    }


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    default_root = Path(__file__).resolve().parents[1]
    parser.add_argument("--root", type=Path, default=default_root)
    parser.add_argument("--output-dir", type=Path)
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    output = args.output_dir or args.root / "staging" / "aws"
    try:
        result = build(args.root, output)
    except BundleError as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 1
    print(json.dumps(result, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

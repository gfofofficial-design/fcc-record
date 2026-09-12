#!/usr/bin/env python3
"""Tests for deterministic FCC staging Lambda packaging."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile


REPO_ROOT = Path(__file__).resolve().parents[1]
BUILDER = REPO_ROOT / "tools" / "build-aws-staging-bundle.py"


def run(command: list[str], cwd: Path, *, check: bool = True) -> subprocess.CompletedProcess[str]:
    result = subprocess.run(command, cwd=cwd, text=True, capture_output=True, check=False)
    if check and result.returncode:
        raise AssertionError(result.stderr or result.stdout)
    return result


def write(root: Path, relative: str, content: str) -> None:
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding="utf-8", newline="\n")


def fixture(root: Path) -> str:
    write(root, ".gitignore", "node_modules/\nstaging/\n")
    write(root, "package.json", json.dumps({"dependencies": {"fake-dep": "1.0.0"}}))
    write(root, "package-lock.json", "{\"lockfileVersion\":3}\n")
    write(root, "tools/aws-staging-intake.js", "require('fake-dep');\n")
    write(root, "tools/lib/aws-staging-intake.js", "module.exports = {};\n")
    write(root, "tools/lib/ulid.js", "module.exports = {};\n")
    write(root, "node_modules/fake-dep/package.json", "{\"name\":\"fake-dep\"}\n")
    write(root, "node_modules/fake-dep/index.js", "module.exports = 1;\n")
    write(root, "node_modules/.bin/ignored", "must not be packaged\n")
    run(["git", "init", "-q"], root)
    run(["git", "config", "user.email", "ci@fcc-record.local"], root)
    run(["git", "config", "user.name", "FCC CI"], root)
    run(["git", "add", "."], root)
    run(["git", "commit", "-qm", "fixture"], root)
    return run(["git", "rev-parse", "HEAD"], root).stdout.strip()


class BundleTests(unittest.TestCase):
    def test_build_is_commit_bound_minimal_and_reproducible(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            commit = fixture(root)
            output = root / "staging" / "aws"
            command = [sys.executable, str(BUILDER), "--root", str(root), "--output-dir", str(output)]
            first = json.loads(run(command, root).stdout)
            archive = Path(first["archivePath"])
            first_bytes = archive.read_bytes()
            second = json.loads(run(command, root).stdout)

            self.assertEqual(first, second)
            self.assertEqual(first["commitSha"], commit)
            self.assertIn(commit, archive.name)
            self.assertEqual(first["archiveSha256"], hashlib.sha256(first_bytes).hexdigest())
            self.assertEqual(first["runtimeDependencies"], ["fake-dep"])
            with zipfile.ZipFile(archive) as bundle:
                names = bundle.namelist()
                self.assertEqual(names, sorted(names))
                self.assertIn("tools/aws-staging-intake.js", names)
                self.assertIn("node_modules/fake-dep/index.js", names)
                self.assertNotIn("node_modules/.bin/ignored", names)
                self.assertTrue(all(info.date_time == (1980, 1, 1, 0, 0, 0) for info in bundle.infolist()))

    def test_dirty_checkout_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root)
            write(root, "tools/aws-staging-intake.js", "dirty\n")
            result = run(
                [sys.executable, str(BUILDER), "--root", str(root)], root, check=False
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("dirty checkout", result.stderr)

    def test_missing_installed_dependency_is_rejected(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            fixture(root)
            for child in (root / "node_modules" / "fake-dep").iterdir():
                child.unlink()
            (root / "node_modules" / "fake-dep").rmdir()
            result = run(
                [sys.executable, str(BUILDER), "--root", str(root)], root, check=False
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("runtime dependency is not installed", result.stderr)


if __name__ == "__main__":
    unittest.main()

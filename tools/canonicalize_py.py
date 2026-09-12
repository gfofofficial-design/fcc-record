#!/usr/bin/env python3
"""Independent Python RFC 8785 canonicalization oracle. Reads JSON from
stdin, writes exact canonical bytes to stdout (no trailing newline added)."""
import sys, json, rfc8785
# Read bytes so JSON uses UTF-8 instead of the Windows console code page.
obj = json.load(sys.stdin.buffer)
sys.stdout.buffer.write(rfc8785.dumps(obj))

#!/usr/bin/env python3
"""Independent Python RFC 8785 canonicalization oracle. Reads JSON from
stdin, writes exact canonical bytes to stdout (no trailing newline added)."""
import sys, json, rfc8785
obj = json.load(sys.stdin)
sys.stdout.buffer.write(rfc8785.dumps(obj))

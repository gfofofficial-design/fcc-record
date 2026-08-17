# DELIVERY ARCHIVE: SOURCE SNAPSHOT — .git intentionally excluded

This archive is a source snapshot only. It does not contain `.git`, and no
git history is delivered or independently inspectable from it. Any local
development history that exists in the build environment is NOT evidence
delivered to the owner and should not be treated as such.

**Recommended genesis procedure** (verified working in the required
clean-room test for this build): extract this archive, run `git init`,
commit the complete tree as one commit — that commit becomes the actual
public genesis of `fcc-record` when pushed to GitHub. Genesis contents
already include the controlling frozen document hashes and evidence under
`governance/frozen/` and `governance/evidence/`.

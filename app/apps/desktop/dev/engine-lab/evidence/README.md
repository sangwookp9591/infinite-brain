<!-- SPDX-License-Identifier: Apache-2.0 -->
# Published measurement evidence

`e1-final-20261020-173052/` contains the completed E1/Q8 comparison: ten independent
native processes, 5,100 CSV rows, gates, fingerprints, frozen prediction, calibration,
statistics and plots. Absolute paths in metadata identify the original execution;
they are observations, not installation instructions. No model or compiled engine
is distributed here. The original local measurement files remain preserved.

Recreate statistics and plots without executing GPU work, after installing the
pinned Python requirements from `harness/requirements.txt`:

```sh
cd app/apps/desktop/dev/engine-lab/harness
.venv/bin/python analyze.py ../evidence/e1-final-20261020-173052
```

The analyzer rejects missing processes, missing scenario rows and failed gates.
The regenerated summary was checked against the original summary for exact JSON
equality. Plot byte encodings can differ across plotting-library environments.

`e4-static82-native-20261020-183359/` is a bounded native correctness gate, not a
performance study. `identity.json` records the source correction, macOS deployment
target and two differently defined model-tree fingerprints. Different fingerprint
algorithms must not be compared as if they represented artifact drift.

`SHA256SUMS` fingerprints this published snapshot, excluding this manifest itself.
After reanalysis, generated plots may need their hashes regenerated; verify the
original snapshot before writing regenerated outputs:

```sh
cd app/apps/desktop/dev/engine-lab/evidence
shasum -a 256 -c SHA256SUMS
```

Earlier diagnostic directories elsewhere in the lab retain their explicit
partial/exploratory labels. Device serial/UUID/UDID lines were removed from one
older E1 diagnostic JSON before publication; its timing rows were unchanged.

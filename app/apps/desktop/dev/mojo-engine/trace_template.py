# SPDX-License-Identifier: Apache-2.0
"""Copy Xcode's Metal System Trace template and enable its saved shader timeline flags."""
import plistlib
import sys
from pathlib import Path

source = Path(
    "/Applications/Xcode.app/Contents/Applications/Instruments.app/Contents/Packages/GPU.instrdst/Contents/Templates/Metal System Trace.tracetemplate"
)
archive = plistlib.loads(source.read_bytes())
objects = archive["$objects"]
objects.append(True)
enabled = plistlib.UID(len(objects) - 1)
changed = []
for obj in list(objects):
    if isinstance(obj, dict) and "NS.keys" in obj:
        for index, key in enumerate(obj["NS.keys"]):
            name = objects[key.data]
            if name in (
                "shaderprofiler",
                "shaderprofilerinternal",
                "countersshaderprofiler",
            ):
                obj["NS.objects"][index] = enabled
                changed.append(name)
assert set(changed) == {
    "shaderprofiler",
    "shaderprofilerinternal",
    "countersshaderprofiler",
}, "Xcode template format changed"
Path(sys.argv[1]).write_bytes(plistlib.dumps(archive, fmt=plistlib.FMT_BINARY))
print("Enabled saved template flags:", ", ".join(changed))

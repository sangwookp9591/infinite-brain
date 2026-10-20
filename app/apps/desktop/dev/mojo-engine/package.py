# SPDX-License-Identifier: Apache-2.0
"""Copy the actual dylib dependency closure, relocate rpaths, and ad-hoc sign."""
import json
import re
import shutil
import subprocess
import sys
from pathlib import Path


def command(*args):
    return subprocess.check_output(args, text=True, stderr=subprocess.STDOUT)


def package(library, runtime_dir, output):
    library, runtime_dir, output = (
        Path(library),
        Path(runtime_dir),
        Path(output),
    )
    output.mkdir(parents=True, exist_ok=True)
    pending, copied = [library], {}
    while pending:
        source = pending.pop()
        if source.name in copied:
            continue
        target = output / source.name
        shutil.copy2(source, target)
        deps = [
            line.strip().split(" (", 1)[0]
            for line in command("otool", "-L", str(source)).splitlines()[2:]
        ]
        copied[source.name] = {"path": str(target), "dependencies": deps}
        for dep in deps:
            if dep.startswith("@rpath/"):
                pending.append(runtime_dir / Path(dep).name)
            elif not dep.startswith(("/usr/lib/", "/System/Library/")):
                raise RuntimeError(f"unhandled dependency {dep}")
    for name, entry in copied.items():
        target = entry["path"]
        command("install_name_tool", "-id", f"@rpath/{name}", target)
        paths = re.findall(
            r"cmd LC_RPATH\s+cmdsize \d+\s+path (.+?) \(offset",
            command("otool", "-l", target),
        )
        for path in paths:
            command("install_name_tool", "-delete_rpath", path, target)
        command("install_name_tool", "-add_rpath", "@loader_path", target)
        command("codesign", "--force", "--sign", "-", target)
        entry["signature_verification"] = command(
            "codesign", "--verify", "--strict", "--verbose=2", target
        ).strip()
        entry["build_version"] = command("vtool", "-show-build", target).strip()
        entry["bytes"] = Path(target).stat().st_size
    manifest = {
        "library": library.name,
        "files": copied,
        "total_runtime_and_library_bytes": sum(
            row["bytes"] for row in copied.values()
        ),
    }
    (output / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(json.dumps(manifest, indent=2))


if __name__ == "__main__":
    package(*sys.argv[1:])

# SPDX-License-Identifier: Apache-2.0
"""Summarize exported Metal tables; never turn sampled shaders into exact dispatch times."""
import json
import re
import statistics
import sys
import xml.etree.ElementTree as ET
from collections import defaultdict
from pathlib import Path

GPU = "start duration channel frame latency depth label state connection color process gpu subtitle iosurface bytes cb encoder submission".split()
APP = "start duration process gpu depth label priority connection color thread type cb encoder".split()
ENC = "start duration thread process gpu frame cb_label cb_name enc_label enc_name type cb encoder".split()
SUB = "start duration type gpu sentinel encoder_count encoder_cpu_time process thread event description enc_desc frame color cb".split()
SHADER = "start duration name label pso event type percent total_percent color priority process gpu channel depth connection".split()
SIGN = "start thread process type scope signpost_id name format backtrace subsystem category message return_location".split()
COLUMNS = {
    "metal-gpu-intervals": GPU,
    "metal-application-intervals": APP,
    "metal-application-encoders-list": ENC,
    "metal-application-command-buffer-submissions": SUB,
    "metal-shader-profiler-intervals": SHADER,
    "os-signpost": SIGN,
}


def union_ns(intervals):
    total = 0
    end = -1
    for start, stop in sorted(intervals):
        total += max(0, stop - max(start, end))
        end = max(stop, end)
    return total


def read_tables(stem):
    toc = ET.parse(str(stem) + "-toc.xml")
    names = {
        f"//trace-toc[1]/run[1]/data[1]/table[{i}]": e.attrib["schema"]
        for i, e in enumerate(toc.findall(".//data/table"), 1)
    }
    root = ET.parse(str(stem) + "-detail.xml").getroot()
    ids = {e.attrib["id"]: e for e in root.iter() if "id" in e.attrib}

    def value(e):
        while "ref" in e.attrib:
            e = ids[e.attrib["ref"]]
        return e.text or "", e.attrib.get("fmt", e.text or "")

    tables = defaultdict(list)
    for node in root.findall("node"):
        name = names[node.attrib["xpath"]]
        if name not in COLUMNS:
            continue
        for row in node.findall("row"):
            columns = COLUMNS[name]
            assert len(row) == len(columns), (name, len(row), len(columns))
            tables[name].append({key: value(e) for key, e in zip(columns, row)})
    return tables


def stage_order():
    order = ["Embedding + PLE setup"] * 4
    layer = [
        "Residual/norm",
        "QKV",
        "Norm/RoPE",
        "Attention",
        "Attention-out",
        "Attention-out",
        "Residual/norm",
        "Residual/norm",
        "FFN",
        "FFN",
        "FFN",
        "Residual/norm",
        "PLE",
        "PLE",
        "PLE",
        "PLE",
        "Residual/norm",
    ]
    order += layer * 24
    order += [
        "Residual/norm",
        "Pooling/output",
        "Pooling/output",
        "Pooling/output",
        "Pooling/output",
    ]
    assert len(order) == 417
    return order


def summarize(stem, engine):
    tables = read_tables(stem)
    marks = defaultdict(dict)
    for row in tables["os-signpost"]:
        if (
            row["name"][1] == "Paragraph"
            and row["subsystem"][1] == "dev.infinitebrain.mojo-opt"
        ):
            marks[row["signpost_id"][0]][row["type"][1]] = int(row["start"][0])
    windows = sorted(
        (v["Begin"], v["End"])
        for v in marks.values()
        if "Begin" in v and "End" in v
    )
    assert (
        len(windows) == 30
    ), f"expected 30 complete measured signposts, got {len(windows)}"
    app = [
        r
        for r in tables["metal-application-intervals"]
        if "trace-bench" in r["process"][1]
    ]
    gpu_by_cb = defaultdict(list)
    for row in tables["metal-gpu-intervals"]:
        if "trace-bench" in row["process"][1]:
            gpu_by_cb[row["cb"][0]].append(
                (
                    int(row["start"][0]),
                    int(row["start"][0]) + int(row["duration"][0]),
                )
            )
    per_stage = defaultdict(lambda: defaultdict(float))
    per_layer = defaultdict(lambda: defaultdict(lambda: defaultdict(float)))
    durations, busy, idle, cpu, cb_counts, enc_counts, cpu_per_cb = (
        [],
        [],
        [],
        [],
        [],
        [],
        [],
    )
    selected_gpu = []
    for begin, end in windows:
        rows = [r for r in app if begin <= int(r["start"][0]) < end]
        buffers = sorted(
            (r for r in rows if r["encoder"][0] == "18446744073709551615"),
            key=lambda r: int(r["start"][0]),
        )
        encoders = [
            r for r in rows if r["encoder"][0] != "18446744073709551615"
        ]
        assert len(buffers) == (425 if engine == "mojo" else 3), (
            engine,
            len(buffers),
        )
        assert len(encoders) == len(
            buffers
        ), "expected one encoder per command buffer"
        duration = (end - begin) / 1e6
        intervals = [i for r in buffers for i in gpu_by_cb[r["cb"][0]]]
        selected_gpu += intervals
        durations.append(duration)
        busy.append(union_ns(intervals) / 1e6)
        # Includes other processes' work; this is target-queue idle, not global device idle.
        span = max(z for a, z in intervals) - min(a for a, z in intervals)
        idle.append((span - union_ns(intervals)) / 1e6)
        cpu.append(sum(int(r["duration"][0]) for r in buffers) / 1e6)
        cpu_per_cb += [int(r["duration"][0]) / 1e3 for r in buffers]
        cb_counts.append(len(buffers))
        enc_counts.append(len(encoders))
        prep = max(0, int(buffers[0]["start"][0]) - begin)
        per_stage["Host prep / shared token IDs"]["host_ms"] += prep / 1e6 / 30
        if engine == "mojo":
            order = (
                ["Uploads/metadata"] * 6
                + stage_order()
                + ["Download/completion"] * 2
            )
        else:
            order = [
                "Entire forward (fine split unavailable)",
                "Entire forward (fine split unavailable)",
                "Download/completion",
            ]
        for index, (row, stage) in enumerate(zip(buffers, order)):
            item = per_stage[stage]
            item["buffers"] += 1 / 30
            item["encoders"] += 1 / 30
            item["cpu_encode_ms"] += int(row["duration"][0]) / 1e6 / 30
            item["gpu_busy_ms"] += union_ns(gpu_by_cb[row["cb"][0]]) / 1e6 / 30
            if engine == "mojo" and 10 <= index < 418:
                layer = (index - 10) // 17
                detail = per_layer[layer][stage]
                detail["buffers"] += 1 / 30
                detail["cpu_encode_ms"] += int(row["duration"][0]) / 1e6 / 30
                detail["gpu_busy_ms"] += (
                    union_ns(gpu_by_cb[row["cb"][0]]) / 1e6 / 30
                )

            if engine == "mojo" and stage not in (
                "Uploads/metadata",
                "Uploads/input",
                "Download/completion",
            ):
                item["dispatches"] += 1 / 30
    shader = defaultdict(
        lambda: {"sampled_intervals": 0, "sampled_ms_per_call": 0.0}
    )
    for row in tables["metal-shader-profiler-intervals"]:
        start = int(row["start"][0])
        if "trace-bench" in row["process"][1] and any(
            a <= start < b for a, b in windows
        ):
            label = re.sub(r" \(\d+\)$", "", row["name"][1])
            shader[label]["sampled_intervals"] += 1
            shader[label]["sampled_ms_per_call"] += (
                int(row["duration"][0]) / 1e6 / 30
            )
    return {
        "engine": engine,
        "measured_calls": 30,
        "median_traced_ms": statistics.median(durations),
        "mean_traced_ms": statistics.mean(durations),
        "mean_gpu_busy_ms": statistics.mean(busy),
        "mean_target_queue_idle_ms": statistics.mean(idle),
        "mean_cpu_encode_ms": statistics.mean(cpu),
        "median_cpu_encode_us_per_buffer": statistics.median(cpu_per_cb),
        "mean_cpu_encode_us_per_buffer": statistics.mean(cpu_per_cb),
        "buffers_per_call": statistics.mean(cb_counts),
        "encoders_per_call": statistics.mean(enc_counts),
        "stages": dict(per_stage),
        "layers": {key: dict(value) for key, value in per_layer.items()},
        "sampled_shader_attribution": dict(shader),
        "shader_intervals_are_dispatch_counts": False,
        "notes": "GPU intervals unioned by command-buffer identity, including split/preempted intervals; stage CPU encoding is wall duration, not on-CPU samples. Llama fine GPU split unavailable inside its two compute encoders. Shader timeline is sampled and cannot fill that gap exactly.",
    }


if __name__ == "__main__":
    stem, engine, output = sys.argv[1:]
    assert engine in ("mojo", "llama")
    result = summarize(Path(stem), engine)
    Path(output).write_text(json.dumps(result, indent=2) + "\n")
    import csv

    with Path(output).with_suffix(".csv").open("w", newline="") as stream:
        writer = csv.DictWriter(
            stream,
            fieldnames=[
                "engine",
                "layer",
                "stage",
                "buffers",
                "gpu_busy_ms",
                "cpu_encode_ms",
                "host_prep_ms",
            ],
        )
        writer.writeheader()
        for stage, metrics in result["stages"].items():
            writer.writerow(
                {
                    "engine": engine,
                    "layer": "all",
                    "stage": stage,
                    "buffers": metrics.get("buffers", ""),
                    "gpu_busy_ms": metrics.get("gpu_busy_ms", ""),
                    "cpu_encode_ms": metrics.get("cpu_encode_ms", ""),
                    "host_prep_ms": metrics.get("host_ms", ""),
                }
            )
        for layer, values in result["layers"].items():
            for stage, metrics in values.items():
                writer.writerow(
                    {
                        "engine": engine,
                        "layer": layer,
                        "stage": stage,
                        **metrics,
                    }
                )
    print(
        json.dumps(
            {
                k: v
                for k, v in result.items()
                if k not in ("stages", "layers", "sampled_shader_attribution")
            },
            indent=2,
        )
    )

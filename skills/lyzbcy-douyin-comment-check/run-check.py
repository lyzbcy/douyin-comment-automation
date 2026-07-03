#!/usr/bin/env python3
import json
import os
import shutil
import subprocess
import sys
from datetime import datetime
from pathlib import Path
from zoneinfo import ZoneInfo

BASE_DIR = Path("/root/.openclaw/workspace/skills/lyzbcy-douyin-comment-check")
CREATOR_DIR = Path("/root/.openclaw/douyin-creator-tools")
OUTPUT_DIR = BASE_DIR / "comments-output"
REPORT_FILE = BASE_DIR / "comment-check-report.md"
MEMORY_REPORT_FILE = BASE_DIR / "memory-insufficient-report.md"
MANIFEST_FILE = OUTPUT_DIR / "reply-plan-manifest.json"
UNREPLIED_FILE = OUTPUT_DIR / "unreplied-latest.json"
SH_TZ = ZoneInfo("Asia/Shanghai")


def now_text() -> str:
    return datetime.now(SH_TZ).strftime("%Y-%m-%d %H:%M:%S")


def shanghai_day() -> str:
    return datetime.now(SH_TZ).strftime("%Y-%m-%d")


def run(cmd, cwd=None, check=True):
    result = subprocess.run(cmd, cwd=cwd, text=True, capture_output=True)
    if check and result.returncode != 0:
        raise RuntimeError(
            f"命令失败: {' '.join(cmd)}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
        )
    return result


def write_report(text: str, also_memory=False):
    REPORT_FILE.write_text(text, encoding="utf-8")
    if also_memory:
        MEMORY_REPORT_FILE.write_text(text, encoding="utf-8")
    print(text)


def memory_available_mb() -> int:
    meminfo = Path("/proc/meminfo").read_text(encoding="utf-8")
    for line in meminfo.splitlines():
        if line.startswith("MemAvailable:"):
            kb = int(line.split()[1])
            return kb // 1024
    raise RuntimeError("无法读取 MemAvailable")


def load_json(path: Path):
    with path.open("r", encoding="utf-8") as handle:
        return json.load(handle)


def file_mtime_text(path: Path) -> str:
    return datetime.fromtimestamp(path.stat().st_mtime, SH_TZ).strftime("%Y-%m-%d %H:%M:%S")


def build_skip_report(freq_output: str):
    return (
        f"# 抖音评论检查任务报告\n\n"
        f"## 执行时间\n{now_text()}\n\n"
        f"## 任务状态\nNO_REPLY\n\n"
        f"## 原因\n{freq_output.strip()}\n\n"
        f"## 说明\n本次因频率限制跳过，没有执行评论采集，也没有生成任何回复。"
    )


def build_memory_report(available_mb: int, freq_output: str):
    return (
        f"# 抖音评论检查任务报告\n\n"
        f"## 执行时间\n{now_text()}\n\n"
        f"## 任务状态\n已停止\n\n"
        f"## 停止原因\n内存不足：可用内存 {available_mb}MB < 200MB\n\n"
        f"## 执行步骤\n"
        f"1. 频率检查：{freq_output.strip()}\n"
        f"2. 内存检查：失败\n"
    )


def build_login_report(stderr_text: str):
    return (
        f"# 抖音评论检查任务报告\n\n"
        f"## 执行时间\n{now_text()}\n\n"
        f"## 任务状态\n需要人工处理\n\n"
        f"## 原因\n登录态失效，抖音创作者中心需要重新登录。\n\n"
        f"## 原始提示\n{stderr_text.strip() or 'LOGIN_EXPIRED'}"
    )


def build_empty_report(freq_output: str):
    return (
        f"# 抖音评论检查任务报告\n\n"
        f"## 执行时间\n{now_text()}\n\n"
        f"## 任务状态\n本次无未回复评论\n\n"
        f"## 执行步骤\n"
        f"1. 频率检查：{freq_output.strip()}\n"
        f"2. 评论采集：0 条\n\n"
        f"## 说明\n本次没有生成回复计划，也没有执行自动回复。"
    )


def build_stale_output_report(freq_output: str, path: Path, reason: str):
    return (
        f"# 抖音评论检查任务报告\n\n"
        f"## 执行时间\n{now_text()}\n\n"
        f"## 任务状态\n执行失败\n\n"
        f"## 原因\n采集结果未通过新鲜度校验。\n\n"
        f"## 详情\n"
        f"- 文件：{path}\n"
        f"- 文件时间：{file_mtime_text(path) if path.exists() else '不存在'}\n"
        f"- 校验失败原因：{reason}\n\n"
        f"## 说明\n本次禁止继续使用旧评论文件，避免把历史未回复评论误当成当前页面结果。"
    )


def build_final_report(freq_output: str, available_mb: int, unreplied_payload: dict, plan_manifest: dict, aggregate: dict):
    lines = [
        "# 抖音评论检查任务报告",
        "",
        f"## 执行时间",
        now_text(),
        "",
        "## 执行结果",
        f"- 频率检查：{freq_output.strip()}",
        f"- 内存检查：通过（可用内存 {available_mb}MB）",
        f"- 采集到未回复评论：{unreplied_payload.get('count', 0)} 条",
        f"- 生成回复计划：{plan_manifest.get('count', 0)} 条，拆分为 {len(plan_manifest.get('plans', []))} 个作品文件",
        f"- 实际回复成功：{aggregate['replied_count']} 条",
        f"- 未匹配到页面评论：{aggregate['unmatched_count']} 条",
        f"- 执行报错：{aggregate['error_count']} 条",
        "",
        "## 采集到的真实评论",
    ]

    for item in unreplied_payload.get("comments", []):
        work = item.get("work") or item.get("workFull") or "未知作品"
        lines.append(f"- @{item.get('username', '')}｜{item.get('commentText', '')}｜作品：{work}")

    lines.extend(["", "## 分作品执行结果"])
    for summary in aggregate["per_plan"]:
        lines.append(
            f"- {summary['plan_name']}｜作品：{summary['work']}｜计划 {summary['count']} 条｜成功 {summary['replied']}｜未匹配 {summary['unmatched']}｜报错 {summary['errors']}"
        )

    if aggregate["remaining_comments"]:
        lines.extend(["", "## 仍未完成的评论"])
        for item in aggregate["remaining_comments"]:
            lines.append(f"- @{item['username']}｜{item['commentText']}｜作品：{item['work']}")

    lines.extend(["", "## 结论"])
    if aggregate["replied_count"] == plan_manifest.get("count", 0) and aggregate["unmatched_count"] == 0 and aggregate["error_count"] == 0:
        lines.append("本次评论已全部按真实结果完成回复。")
    elif aggregate["replied_count"] == 0:
        lines.append("本次没有成功回复任何评论，仍需继续排查或人工处理。")
    else:
        lines.append("本次只完成了部分回复，仍有评论未处理完，不能汇报为“全部成功”。")

    return "\n".join(lines)


def main():
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    collect_started_at = None

    freq_result = run(["python3", str(BASE_DIR / "adjust-check-freq.py")], cwd=BASE_DIR)
    freq_output = (freq_result.stdout or freq_result.stderr).strip()

    if freq_output.startswith("SKIP:"):
        write_report(build_skip_report(freq_output))
        return

    available_mb = memory_available_mb()
    if available_mb < 200:
        write_report(build_memory_report(available_mb, freq_output), also_memory=True)
        return

    marker = BASE_DIR / f"works-refreshed-{shanghai_day()}"
    if not marker.exists():
        run(["npm", "run", "works"], cwd=BASE_DIR)

    collect_started_at = datetime.now().timestamp()
    
    # Call comments:collect via collect-comments.js proxy -> douyin-creator-tools.
    # Do NOT run comments:export with cwd=BASE_DIR: BASE_DIR package.json has no such script,
    # it just npm-errors and gets swallowed by except -> always 0 comments.
    collect_proc = subprocess.run(
        ["npm", "run", "comments:collect", "--", "--max-works", "8", "--limit", "50"],
        cwd=BASE_DIR,
        text=True,
        capture_output=True,
        timeout=900,
    )
    if collect_proc.stdout:
        print(collect_proc.stdout)
    if collect_proc.returncode != 0:
        combined = (collect_proc.stdout or "") + (collect_proc.stderr or "")
        if "LOGIN_EXPIRED" in combined or collect_proc.returncode == 2:
            write_report(build_login_report(combined))
            return
        raise RuntimeError(
            f"comments collect failed (exit={collect_proc.returncode})\nstdout:\n{collect_proc.stdout}\nstderr:\n{collect_proc.stderr}"
        )

    # Proxy has synced unreplied-latest.json into BASE_DIR; validate freshness.
    if not UNREPLIED_FILE.exists() or UNREPLIED_FILE.stat().st_mtime < collect_started_at:
        write_report(build_stale_output_report(
            freq_output,
            UNREPLIED_FILE,
            "collect finished but unreplied-latest.json not updated this run (proxy sync missing)",
        ))
        return

    unreplied_payload = load_json(UNREPLIED_FILE)
    comments_list = unreplied_payload.get("comments", []) if isinstance(unreplied_payload, dict) else unreplied_payload
    unreplied_payload = {"count": len(comments_list), "comments": comments_list}

    # 写汇总
    UNREPLIED_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(UNREPLIED_FILE, "w", encoding="utf-8") as f:
        json.dump(unreplied_payload, f, ensure_ascii=False)
    if unreplied_payload.get("count", 0) == 0:
        write_report(build_empty_report(freq_output))
        return

    run(["python3", str(BASE_DIR / "process-comments.py")], cwd=BASE_DIR)
    plan_manifest = load_json(MANIFEST_FILE)

    aggregate = {
        "replied_count": 0,
        "unmatched_count": 0,
        "error_count": 0,
        "per_plan": [],
        "remaining_comments": [],
    }

    for plan in plan_manifest.get("plans", []):
        plan_path = Path(plan["file"])
        result = subprocess.run(
            ["npm", "run", "comments:reply", "--", str(plan_path)],
            cwd=BASE_DIR,
            text=True,
            capture_output=True,
        )
        if result.returncode != 0:
            raise RuntimeError(
                f"评论回复失败: {plan_path.name}\nstdout:\n{result.stdout}\nstderr:\n{result.stderr}"
            )

        result_name = plan["name"].replace("reply-plan", "reply-comments-result")
        result_path = OUTPUT_DIR / result_name
        payload = load_json(result_path)

        replied = int(payload.get("repliedCount", 0))
        unmatched = int(payload.get("unmatchedPlanCount", 0))
        errors = int(payload.get("errorCount", 0))
        aggregate["replied_count"] += replied
        aggregate["unmatched_count"] += unmatched
        aggregate["error_count"] += errors
        aggregate["per_plan"].append(
            {
                "plan_name": plan["name"],
                "work": plan.get("work") or plan.get("workFull") or "未知作品",
                "count": plan.get("count", 0),
                "replied": replied,
                "unmatched": unmatched,
                "errors": errors,
            }
        )

        unmatched_plans = payload.get("unmatchedPlans", [])
        for item in unmatched_plans:
            aggregate["remaining_comments"].append(
                {
                    "username": item.get("username", ""),
                    "commentText": item.get("commentText", ""),
                    "work": plan.get("work") or plan.get("workFull") or "未知作品",
                }
            )

    report = build_final_report(freq_output, available_mb, unreplied_payload, plan_manifest, aggregate)
    write_report(report)


if __name__ == "__main__":
    main()

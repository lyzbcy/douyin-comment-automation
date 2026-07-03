#!/usr/bin/env python3
"""
抖音评论检查 - 自适应频率调整器

根据评论趋势动态调整检查频率：
- 最高频率：1小时一次（连续3次）
- 最低频率：6小时一次
- 每3天评估一次，根据最近评论趋势调整

评估逻辑：
- 读取最近评论检查结果（unreplied-latest.json）
- 读取频率配置文件（check-freq-config.json）
- 根据趋势调整下次检查间隔

使用方式：
  python3 adjust-check-freq.py           # 评估并调整频率
  python3 adjust-check-freq.py --status   # 查看当前状态
  python3 adjust-check-freq.py --force <hours>  # 强制设置间隔
"""

import json
import os
import sys
import subprocess
from datetime import datetime, timedelta
from pathlib import Path

BASE_DIR = Path("~/.openclaw/douyin-creator-tools").expanduser()
CONFIG_FILE = BASE_DIR / "comments-output" / "check-freq-config.json"
UNREPLIED_FILE = BASE_DIR / "comments-output" / "unreplied-latest.json"

MIN_INTERVAL_HOURS = 1      # 最高频：1小时
MAX_INTERVAL_HOURS = 6      # 最低频：6小时
EVAL_WINDOW_DAYS = 3        # 3天评估一次
AGGRESSIVE_THRESHOLD = 2    # 3天内有多少次发现新评论 → 升频
# 如果3天内0次有新评论 → 降到最低
# 如果3天内 >= AGGRESSIVE_THRESHOLD 次有新评论 → 升到最高
# 中间按线性插值


def load_config():
    """加载频率配置文件"""
    if CONFIG_FILE.exists():
        with open(CONFIG_FILE) as f:
            return json.load(f)
    # 默认配置
    return {
        "currentIntervalHours": 1,  # 当前间隔（小时）
        "lastEvalDate": datetime.now().strftime("%Y-%m-%d"),
        "history": [],  # 最近N天的检查记录摘要
        "evalResults": []  # 每次评估的结果
    }


def save_config(config):
    """保存频率配置"""
    CONFIG_FILE.parent.mkdir(parents=True, exist_ok=True)
    with open(CONFIG_FILE, "w") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


def get_cron_runs_summary(days=3):
    """获取最近N天的cron运行历史，统计有多少次发现了新评论"""
    try:
        result = subprocess.run(
            ["openclaw", "cron", "runs",
             "--id", "d138d798-276d-4250-b73e-84bdcd6f2631",
             "--limit", "72"],  # 3天 * 24小时
            capture_output=True, text=True, timeout=30
        )
        if result.returncode != 0:
            return None

        data = json.loads(result.stdout)
        cutoff = datetime.now() - timedelta(days=days)
        found_new = 0
        total_runs = 0

        for entry in data.get("entries", []):
            ts = entry.get("ts", 0)
            run_time = datetime.fromtimestamp(ts / 1000)
            if run_time < cutoff:
                continue

            total_runs += 1
            summary = entry.get("summary", "")
            # 判断是否有实际需要回复的新评论
            # 核心逻辑：只在明确提到有非零未回复评论时才算
            has_new = False
            if "内存不足" in summary or "登录失效" in summary:
                total_runs -= 1  # 异常不计入
            else:
                import re
                # 精确匹配「未回复评论」后面紧跟的数字（允许 ** 等markdown包裹）
                m = re.search(r'未回复评论[：:]*\s*\**\s*(\d+)\s*\**\s*条', summary)
                if m and int(m.group(1)) > 0:
                    has_new = True
            # 否则：没有明确提到有非零未回复评论 → has_new = False
            
            if has_new:
                found_new += 1

        return {
            "totalRuns": total_runs,
            "foundNewComments": found_new,
            "emptyRuns": total_runs - found_new,
            "windowDays": days
        }
    except Exception as e:
        print(f"[warn] 获取cron历史失败: {e}")
        return None


def calculate_interval(stats):
    """根据统计计算推荐间隔"""
    if stats is None:
        return 1  # 默认最高频

    found_new = stats["foundNewComments"]
    total = stats["totalRuns"]

    if total == 0:
        # cron history unavailable (openclaw cli / node version issue) ->
        # keep high frequency instead of dropping to MAX, otherwise the
        # interval lock would SKIP forever and comments never get replied.
        return MIN_INTERVAL_HOURS

    if found_new == 0:
        # 完全没有新评论 → 最低频
        return MAX_INTERVAL_HOURS
    elif found_new >= AGGRESSIVE_THRESHOLD:
        # 频繁有新评论 → 最高频
        return MIN_INTERVAL_HOURS
    else:
        # 中间状态：线性插值
        ratio = found_new / AGGRESSIVE_THRESHOLD
        interval = MAX_INTERVAL_HOURS - ratio * (MAX_INTERVAL_HOURS - MIN_INTERVAL_HOURS)
        return round(interval)


def should_evaluate(config):
    """判断是否需要执行评估（3天一次）"""
    last_eval = config.get("lastEvalDate", "")
    if not last_eval:
        return True
    try:
        last = datetime.strptime(last_eval, "%Y-%m-%d")
        days_since = (datetime.now() - last).days
        return days_since >= EVAL_WINDOW_DAYS
    except:
        return True


def update_cron_schedule(interval_hours):
    """更新cron任务的调度频率
    
    策略：不在Python里改cron schedule（太复杂），而是：
    - cron保持每小时触发
    - 在skill执行前先调本脚本
    - 如果距离上次检查不足interval，输出skip指令
    """
    config = load_config()
    last_check = config.get("lastCheckTime")
    
    if last_check:
        try:
            last_dt = datetime.fromisoformat(last_check)
            elapsed = (datetime.now() - last_dt).total_seconds() / 3600
            if elapsed < interval_hours:
                remaining = interval_hours - elapsed
                print(f"SKIP: 距上次检查仅 {elapsed:.1f}h，需间隔 {interval_hours}h，剩余 {remaining:.1f}h")
                return False
        except:
            pass

    # 记录本次检查时间
    config["lastCheckTime"] = datetime.now().isoformat()
    save_config(config)
    print(f"OK: 允许执行检查（间隔 {interval_hours}h）")
    return True


def run_evaluate():
    """执行频率评估"""
    config = load_config()
    
    # 即使不到3天也可以被手动触发
    stats = get_cron_runs_summary(days=EVAL_WINDOW_DAYS)
    
    if stats is None:
        print("[warn] 无法获取统计，保持当前频率")
        return config

    new_interval = calculate_interval(stats)
    old_interval = config.get("currentIntervalHours", 1)

    eval_result = {
        "date": datetime.now().isoformat(),
        "stats": stats,
        "oldInterval": old_interval,
        "newInterval": new_interval,
        "changed": old_interval != new_interval
    }

    config["currentIntervalHours"] = new_interval
    config["lastEvalDate"] = datetime.now().strftime("%Y-%m-%d")
    config["evalResults"].append(eval_result)
    # 只保留最近10次评估
    config["evalResults"] = config["evalResults"][-10:]

    save_config(config)

    if eval_result["changed"]:
        direction = "↑升频" if new_interval < old_interval else "↓降频"
        print(f"[adjust] {direction}: {old_interval}h → {new_interval}h")
        print(f"  近{EVAL_WINDOW_DAYS}天: {stats['totalRuns']}次检查, {stats['foundNewComments']}次发现新评论")
    else:
        print(f"[keep] 维持 {new_interval}h 间隔")
        print(f"  近{EVAL_WINDOW_DAYS}天: {stats['totalRuns']}次检查, {stats['foundNewComments']}次发现新评论")

    return config


def show_status():
    """显示当前状态"""
    config = load_config()
    interval = config.get("currentIntervalHours", 1)
    last_eval = config.get("lastEvalDate", "从未")
    last_check = config.get("lastCheckTime", "从未")

    print("📊 抖音评论检查频率状态")
    print(f"  当前间隔: {interval} 小时")
    print(f"  上次评估: {last_eval}")
    print(f"  上次检查: {last_check}")

    if config.get("evalResults"):
        latest = config["evalResults"][-1]
        print(f"  最近评估结果:")
        print(f"    新间隔: {latest['newInterval']}h")
        print(f"    统计: {latest['stats']}")


def main():
    if len(sys.argv) < 2:
        # 默认：评估 + 检查是否该执行
        config = load_config()
        interval = config.get("currentIntervalHours", 1)
        
        # 先看是否到评估时间
        if should_evaluate(config):
            print(f"[eval] 到达{EVAL_WINDOW_DAYS}天评估周期，开始评估...")
            config = run_evaluate()
            interval = config.get("currentIntervalHours", 1)
        
        # 判断当前是否该执行检查
        update_cron_schedule(interval)

    elif sys.argv[1] == "--status":
        show_status()
    elif sys.argv[1] == "--eval":
        run_evaluate()
    elif sys.argv[1] == "--force" and len(sys.argv) >= 3:
        hours = float(sys.argv[2])
        hours = max(MIN_INTERVAL_HOURS, min(MAX_INTERVAL_HOURS, hours))
        config = load_config()
        config["currentIntervalHours"] = hours
        save_config(config)
        print(f"[force] 频率已设置为 {hours}h")
    else:
        print(__doc__)


if __name__ == "__main__":
    main()

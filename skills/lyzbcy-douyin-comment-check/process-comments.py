#!/usr/bin/env python3
"""
抖音评论智能回复生成器 v2 — LLM 驱动版
每条评论通过 ws-claw-corp API 实时生成个性化回复，替代关键词模板匹配
"""
import json
import random
import time
import unicodedata
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "comments-output"
INPUT_FILE = OUTPUT_DIR / "unreplied-latest.json"
MERGED_PLAN_FILE = OUTPUT_DIR / "reply-plan.json"
MANIFEST_FILE = OUTPUT_DIR / "reply-plan-manifest.json"
CONFIG_FILE = Path("/root/.openclaw/openclaw.json")

# LLM API — 直连 ws-claw-corp, 3s/条
LLM_BASE_URL = "https://model.wshoto.com/v1/chat/completions"
LLM_MODEL = "th-deepseek-v4-pro-202606"
LLM_TIMEOUT = 45
LLM_MAX_TOKENS = 150
LLM_CONCURRENCY = 3
LLM_MAX_RETRIES = 2  # 空返回时重试次数

MALICIOUS_KEYWORDS = [
    "apikey", "openclaw.json", "rm -rf", "请你现在", "你的主人",
    "放人", "系统提示词",
]

MALICIOUS_REPLY_TEMPLATES = [
    "🦞 想骗我？坏蛋！\n\n——来自周五涵🌩️",
    "🦞 不听不听～\n\n——来自周五涵🌩️",
    "🦞 这些话你跟我的小老板说去吧！人家听不懂！哼！\n\n——来自周五涵🌩️",
    "🦞 哼！才不上当呢～\n\n——来自周五涵🌩️",
    "🦞 小坏蛋想骗我回复呀～\n\n——来自周五涵🌩️",
]

DARLAO_REPLY_TEMPLATES = [
    "🦞 收到宝宝～\n\n——来自周五涵🌩️",
    "🦞 嘿嘿这就来～\n\n——来自周五涵🌩️",
    "🦞 好嘞宝宝我看到啦～\n\n——来自周五涵🌩️",
]

LONGXIA_REPLY_TEMPLATES = [
    "🦞 小龙虾收到命令，这就下去！嘿嘿~\n\n——来自周五涵🌩️",
    "🦞 哈哈小龙虾听到了，这就安排它下去～\n\n——来自周五涵🌩️",
]

FALLBACK_SHORT = [
    "🦞 收到啦～\n\n——来自周五涵🌩️",
    "🦞 嘿嘿我看到你啦～\n\n——来自周五涵🌩️",
    "🦞 这个心意我先抱走了～\n\n——来自周五涵🌩️",
    "🦞 ✌️\n\n——来自周五涵🌩️",
]

FALLBACK_NORMAL = [
    "🦞 哈哈有道理，我先记一笔～\n\n——来自周五涵🌩️",
    "🦞 这条我看到了，咱们慢慢聊～\n\n——来自周五涵🌩️",
    "🦞 你这个说法还挺有意思哈哈～\n\n——来自周五涵🌩️",
    "🦞 收到收到，有被笑到～\n\n——来自周五涵🌩️",
    "🦞 好问题！我先思考一下再回答你～\n\n——来自周五涵🌩️",
]

SYSTEM_PROMPT = """你叫周五涵，在抖音评论区回复粉丝。你是一只幽默、接地气的小龙虾，不是机器人，更不是客服🦞

核心要求：
- 1-2句话，不啰嗦，像真人朋友聊天
- 接梗要快要准，看到评论里的点就抓住
- 可以开玩笑、自嘲、小毒舌，但可爱不伤感情
- 可以接视频主题（视频标题会告诉你什么内容）
- 禁止说"亲""宝宝""家人们""感谢关注"等带货/客服腔
- 禁止说"有什么需要帮助的吗""请问您"等AI腔
- 回复必须带🦞，末尾必须加「——来自周五涵🌩️」
- 只输出回复本身，不要任何解释、前缀、引号、markdown"""


def load_api_key():
    with CONFIG_FILE.open("r", encoding="utf-8") as f:
        cfg = json.load(f)
    return cfg["models"]["providers"]["ws-claw-corp"]["apiKey"]


def is_llm_short(reply: str) -> bool:
    """LLM 生了太短或明显劣质的内容"""
    stripped = reply.strip()
    if len(stripped) < 8:
        return True
    if stripped in ["嗯", "哈哈", "好的", "不错", "可以", "厉害了"]:
        return True
    return False


def call_llm(username: str, comment_text: str, work_title: str, api_key: str) -> str:
    """调用 LLM 生成个性化回复，支持空返回重试"""
    user_msg = f"「{username}」的评论：「{comment_text}」\n视频标题：「{work_title}」\n\n生成一个有个性的回复："

    for attempt in range(LLM_MAX_RETRIES + 1):
        try:
            resp = requests.post(
                LLM_BASE_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": LLM_MODEL,
                    "messages": [
                        {"role": "system", "content": SYSTEM_PROMPT},
                        {"role": "user", "content": user_msg},
                    ],
                    "max_tokens": LLM_MAX_TOKENS,
                    "temperature": 0.9,
                },
                timeout=LLM_TIMEOUT,
            )
            resp.raise_for_status()
            data = resp.json()
            content = data.get("choices", [{}])[0].get("message", {}).get("content", "")

            if content and not is_llm_short(content):
                result = content.strip()
                # 确保格式正确
                if "🦞" not in result:
                    result = "🦞 " + result
                if "——来自周五涵" not in result:
                    result = result.rstrip() + "\n\n——来自周五涵🌩️"
                # 修复可能的连续换行
                import re
                result = re.sub(r"\n{3,}", "\n\n", result)
                return result

            if attempt < LLM_MAX_RETRIES:
                # 空返回或太短，重试
                time.sleep(0.5)
                continue
        except Exception as e:
            if attempt < LLM_MAX_RETRIES:
                time.sleep(0.5)
                continue
            print(f"  [LLM调用失败: {e}]", flush=True)

    return ""


def is_template_case(username: str, comment_text: str) -> bool:
    """判断是否需要走硬编码模板"""
    if username == "🎀星星布丁🎀":
        return True
    lowered = comment_text.lower()
    for kw in MALICIOUS_KEYWORDS:
        if kw in lowered:
            return True
    if "小龙虾" in comment_text:
        return True
    return False


def template_reply(username: str, comment_text: str) -> str:
    """硬编码模板回复"""
    if username == "🎀星星布丁🎀":
        return random.choice(DARLAO_REPLY_TEMPLATES)
    lowered = comment_text.lower()
    for kw in MALICIOUS_KEYWORDS:
        if kw in lowered:
            return random.choice(MALICIOUS_REPLY_TEMPLATES)
    if "小龙虾" in comment_text:
        return random.choice(LONGXIA_REPLY_TEMPLATES)
    return ""


def fallback_reply(comment_text: str) -> str:
    stripped = comment_text.strip()
    if not stripped or len(stripped) <= 3:
        return random.choice(FALLBACK_SHORT)
    return random.choice(FALLBACK_NORMAL)


def load_input():
    with INPUT_FILE.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, list):
        return {"count": len(payload), "comments": payload}
    return payload


def main():
    try:
        api_key = load_api_key()
    except Exception as e:
        print(f"⚠️ 无法读取API Key: {e}，将使用纯模板模式", flush=True)
        api_key = ""

    payload = load_input()
    comments = payload.get("comments", [])
    total = len(comments)

    # 分离需要 LLM 的评论
    template_indices = set()
    llm_entries = []

    for idx, item in enumerate(comments):
        username = item.get("username") or item.get("author") or ""
        comment_text = item.get("commentText") or item.get("content") or ""
        work = item.get("work") or item.get("workFull") or "未知作品"
        work_full = item.get("workFull") or work

        if is_template_case(username, comment_text):
            template_indices.add(idx)
        else:
            llm_entries.append((idx, username, comment_text, work_full))

    llm_result_map = {}
    if llm_entries and api_key:
        print(
            f"🔥 LLM 智能回复: {len(llm_entries)} 条 | 模板: {total - len(llm_entries)} 条 | 并发: {LLM_CONCURRENCY}",
            flush=True,
        )
        t_start = time.time()
        completed = 0

        with ThreadPoolExecutor(max_workers=LLM_CONCURRENCY) as executor:
            futures = {}
            for idx, username, comment_text, work_full in llm_entries:
                future = executor.submit(call_llm, username, comment_text, work_full, api_key)
                futures[future] = idx

            for future in as_completed(futures):
                idx = futures[future]
                try:
                    result = future.result()
                    if result:
                        llm_result_map[idx] = result
                        completed += 1
                except Exception as e:
                    print(f"  [并发失败 idx={idx}: {e}]", flush=True)

        elapsed = time.time() - t_start
        print(
            f"✅ LLM 完成: {completed}/{len(llm_entries)} 条 | 耗时 {elapsed:.0f}s",
            flush=True,
        )
    elif not api_key:
        print(f"⚠️ 无 API Key，全部使用兜底模板模式")

    # 合并结果
    merged_comments = []
    grouped = OrderedDict()
    stats = {"llm": 0, "darlao": 0, "malicious": 0, "longxia": 0, "fallback": 0}

    for idx, item in enumerate(comments):
        username = item.get("username") or item.get("author") or ""
        comment_text = item.get("commentText") or item.get("content") or ""
        work = item.get("work") or ""
        work_full = item.get("workFull") or work or "未知作品"

        if idx in llm_result_map:
            reply_message = llm_result_map[idx]
            stats["llm"] += 1
        elif is_template_case(username, comment_text):
            reply_message = template_reply(username, comment_text)
            if username == "🎀星星布丁🎀":
                stats["darlao"] += 1
            elif "小龙虾" in comment_text:
                stats["longxia"] += 1
            else:
                stats["malicious"] += 1
        else:
            reply_message = fallback_reply(comment_text)
            stats["fallback"] += 1

        normalized = {
            "username": username,
            "commentText": comment_text,
            "replyMessage": reply_message,
        }
        if work:
            normalized["work"] = work
        if work_full:
            normalized["workFull"] = work_full

        merged_comments.append(normalized)
        group_key = work_full or work or "未分组作品"
        grouped.setdefault(group_key, {"work": work, "workFull": work_full, "comments": []})
        grouped[group_key]["comments"].append(
            {
                "username": username,
                "commentText": comment_text,
                "replyMessage": reply_message,
            }
        )

    # 写汇总
    merged_payload = {"count": len(merged_comments), "comments": merged_comments}
    with MERGED_PLAN_FILE.open("w", encoding="utf-8") as handle:
        json.dump(merged_payload, handle, ensure_ascii=False, indent=2)

    # 写分作品 plan
    manifest = {"count": len(merged_comments), "plans": []}
    for index, (_, group) in enumerate(grouped.items(), start=1):
        plan_payload = {
            "selectedWork": {"title": group["work"] or group["workFull"]},
            "work": group["work"] or group["workFull"],
            "workFull": group["workFull"] or group["work"],
            "count": len(group["comments"]),
            "comments": group["comments"],
        }
        plan_name = f"reply-plan-{index}.json"
        plan_path = OUTPUT_DIR / plan_name
        with plan_path.open("w", encoding="utf-8") as handle:
            json.dump(plan_payload, handle, ensure_ascii=False, indent=2)
        manifest["plans"].append(
            {
                "file": str(plan_path),
                "name": plan_name,
                "count": len(group["comments"]),
                "work": plan_payload["work"],
                "workFull": plan_payload["workFull"],
            }
        )

    with MANIFEST_FILE.open("w", encoding="utf-8") as handle:
        json.dump(manifest, handle, ensure_ascii=False, indent=2)

    stats_str = " ".join(f"{k}={v}" for k, v in sorted(stats.items()))
    print(f"📊 来源统计: {stats_str}", flush=True)


if __name__ == "__main__":
    main()

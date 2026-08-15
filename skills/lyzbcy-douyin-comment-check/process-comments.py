#!/usr/bin/env python3
"""
抖音评论智能回复生成器 v3 — LLM 驱动 + 正则兜底 + 日志入库

核心流程：
1. 每条评论优先走 LLM API 生成个性化回复
2. LLM 失败时按优先级降级：正则匹配(评论内容) → 通用模板
3. 所有回复均记录到 SQLite (reply_logs.db)，供审计和统计

身份信息（昵称/人设/特殊用户/模板）从同目录 persona.json 加载，
换 agent 时只需改 persona.json，无需改动本文件。见 persona.example.json。

v3 变更 (2026-08-15)：
- VIP 用户（大老板）不走模板，改为专属 system prompt + LLM 生成
- 新增 fallbackReply 正则匹配（persona.json 的 fallbackPatterns），
  LLM 失败时先按评论内容特征匹配个性化回复，再降级到通用模板
- 所有回复写入 SQLite 数据库 (log_db.py)，自动保留30天
"""
import json
import random
import re
import time
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

import requests

BASE_DIR = Path(__file__).resolve().parent
OUTPUT_DIR = BASE_DIR / "comments-output"
INPUT_FILE = OUTPUT_DIR / "unreplied-latest.json"
MERGED_PLAN_FILE = OUTPUT_DIR / "reply-plan.json"
MANIFEST_FILE = OUTPUT_DIR / "reply-plan-manifest.json"
# openclaw.json 路径——可移植探测，不写死任何用户家目录
# 优先级：环境变量 OPENCLAW_CONFIG > 当前用户 ~/.openclaw/openclaw.json > 旧路径兜底
# 这样 root / ubuntu / 任何用户运行都正确，迁移到新环境无需改代码。
CONFIG_FILE = Path(__import__("os").environ.get("OPENCLAW_CONFIG", str(Path.home() / ".openclaw" / "openclaw.json")))
PERSONA_FILE = BASE_DIR / "persona.json"

# LLM API — 直连 ws-claw-corp, 3s/条
LLM_BASE_URL = "https://model.wshoto.com/v1/chat/completions"
LLM_MODEL = "th-deepseek-v4-pro-202606"
LLM_TIMEOUT = 45
LLM_MAX_TOKENS = 150
LLM_CONCURRENCY = 3
LLM_MAX_RETRIES = 2  # 空返回时重试次数


# 引入日志模块
from log_db import log_reply, cleanup_old_logs  # noqa: E402


def _fill(template: str, identity: dict) -> str:
    """用 identity 字段填充模板占位符 {name}/{sig}/{emoji}/{persona}。
    使用 replace 而非 format，这样 {username} 等运行时占位符会保留原样。"""
    result = template
    result = result.replace("{name}", identity["name"])
    result = result.replace("{sig}", identity["signature"])
    result = result.replace("{emoji}", identity["emoji"])
    result = result.replace("{persona}", identity["persona"])
    return result


def load_persona() -> dict:
    """加载 persona.json 并渲染所有占位符，返回处理后的 persona 字典。

    模板字符串里的 {name}/{sig}/{emoji}/{persona} 会被 identity 字段替换，
    使回复文案与具体昵称解耦。文件缺失时给出清晰指引。
    """
    if not PERSONA_FILE.exists():
        raise RuntimeError(
            f"缺少 persona.json: {PERSONA_FILE}\n"
            f"请复制 persona.example.json 为 persona.json 并填写 agent 身份信息。"
        )
    with PERSONA_FILE.open("r", encoding="utf-8") as f:
        raw = json.load(f)

    identity = raw["identity"]
    # 渲染所有模板里的占位符
    rendered_templates = {}
    for key, templates in raw.get("replyTemplates", {}).items():
        rendered_templates[key] = [_fill(t, identity) for t in templates]

    system_prompt = _fill(raw["systemPromptTemplate"], identity)
    system_prompt_vip = _fill(raw.get("systemPromptTemplateVIP", ""), identity) if raw.get("systemPromptTemplateVIP") else ""

    # 渲染所有 fallbackPatterns 里的 {sig}/{emoji}/{name}/{persona} 占位符
    rendered_fallback_patterns = []
    for pattern in raw.get("fallbackPatterns", []):
        rendered_fallback_patterns.append({
            "pattern": pattern["pattern"],
            "replies": [_fill(t, identity) for t in pattern["replies"]],
        })

    return {
        "identity": identity,
        "roles": raw.get("roles", {}),
        "commandKeyword": raw.get("commandKeyword", ""),
        "maliciousKeywords": raw.get("maliciousKeywords", []),
        "replyTemplates": rendered_templates,
        "fallbackPatterns": rendered_fallback_patterns,
        "systemPrompt": system_prompt,
        "systemPromptVIP": system_prompt_vip,
    }


PERSONA = load_persona()

# 从 persona.json 加载正则降级模式
FALLBACK_PATTERNS = PERSONA.get("fallbackPatterns", [])


def regex_fallback_reply(comment_text: str, username: str = "") -> str:
    """按正则匹配评论内容，返回个性化降级回复。
    匹配优先级：先匹配的先返回。无匹配返回空字符串。
    支持 {username} 占位符，自动替换为评论用户名。"""
    for pattern in FALLBACK_PATTERNS:
        try:
            if re.search(pattern["pattern"], comment_text, re.IGNORECASE):
                reply = random.choice(pattern["replies"])
                if "{username}" in reply and username:
                    reply = reply.replace("{username}", username)
                return reply
        except re.error:
            continue
    return ""


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
    is_vip = username and username == _vip_username()
    identity = PERSONA["identity"]
    emoji = identity["emoji"]
    sig = identity["signature"]
    sig_tail = sig.split("来自")[-1] if "来自" in sig else sig

    # VIP 用户（大老板）用专属 system prompt，语气更亲昵
    if is_vip:
        system_prompt = PERSONA["systemPromptVIP"]
    else:
        system_prompt = PERSONA["systemPrompt"]

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
                        {"role": "system", "content": system_prompt},
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
                if emoji not in result:
                    result = f"{emoji} " + result
                if sig not in result and sig_tail not in result:
                    result = result.rstrip() + f"\n\n{sig}"
                result = re.sub(r"\n{3,}", "\n\n", result)
                return result

            if attempt < LLM_MAX_RETRIES:
                time.sleep(0.5)
                continue
        except Exception as e:
            if attempt < LLM_MAX_RETRIES:
                time.sleep(0.5)
                continue
            print(f"  [LLM调用失败: {e}]", flush=True)

    return ""


def _vip_username() -> str:
    return PERSONA["roles"].get("vip", {}).get("username", "")


def is_template_case(username: str, comment_text: str) -> bool:
    """判断是否需要走硬编码模板（仅恶意注入/命令关键词，VIP 不再拦截）"""
    lowered = comment_text.lower()
    for kw in PERSONA["maliciousKeywords"]:
        if kw in lowered:
            return True
    if PERSONA["commandKeyword"] and PERSONA["commandKeyword"] in comment_text:
        return True
    return False


def template_reply(username: str, comment_text: str) -> str:
    """按 persona 模板回复（仅恶意注入/命令关键词，VIP 不再走模板）"""
    templates = PERSONA["replyTemplates"]
    lowered = comment_text.lower()
    for kw in PERSONA["maliciousKeywords"]:
        if kw in lowered:
            return random.choice(templates.get("malicious", []))
    if PERSONA["commandKeyword"] and PERSONA["commandKeyword"] in comment_text:
        return random.choice(templates.get("command", []))
    return ""


def fallback_reply(comment_text: str, username: str = "") -> str:
    """降级回复：优先按正则匹配（带用户名），再降级到通用模板"""
    # 先试正则匹配
    regex_result = regex_fallback_reply(comment_text, username)
    if regex_result:
        return regex_result
    # 再试通用模板
    stripped = comment_text.strip()
    templates = PERSONA["replyTemplates"]
    if not stripped or len(stripped) <= 3:
        return random.choice(templates.get("fallbackShort", []))
    return random.choice(templates.get("fallbackNormal", []))


def load_input():
    with INPUT_FILE.open("r", encoding="utf-8") as handle:
        payload = json.load(handle)
    if isinstance(payload, list):
        return {"count": len(payload), "comments": payload}
    return payload


def _classify(username: str, comment_text: str) -> str:
    """返回模板来源分类名（用于统计），与 is_template_case 逻辑对齐。"""
    lowered = comment_text.lower()
    for kw in PERSONA["maliciousKeywords"]:
        if kw in lowered:
            return "malicious"
    if PERSONA["commandKeyword"] and PERSONA["commandKeyword"] in comment_text:
        return "command"
    # VIP 和普通用户全走 LLM，降级时区分
    return "llm"  # 默认期望 LLM，实际降级时在 main 里改


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
    stats = {"llm": 0, "vip_llm": 0, "malicious": 0, "command": 0, "regex_fallback": 0, "fallback": 0}

    for idx, item in enumerate(comments):
        username = item.get("username") or item.get("author") or ""
        comment_text = item.get("commentText") or item.get("content") or ""
        work = item.get("work") or ""
        work_full = item.get("workFull") or work or "未知作品"
        is_vip = username and username == _vip_username()

        if idx in llm_result_map:
            reply_message = llm_result_map[idx]
            source_type = "vip_llm" if is_vip else "llm"
            stats[source_type] += 1
            log_reply(source_type, username, comment_text, work_full, reply_message,
                      model=LLM_MODEL)
        elif is_template_case(username, comment_text):
            reply_message = template_reply(username, comment_text)
            source_type = _classify(username, comment_text)
            stats[source_type] += 1
            log_reply(source_type, username, comment_text, work_full, reply_message,
                      success=True, error_reason="模板匹配")
        else:
            reply_message = fallback_reply(comment_text, username)
            # 判断是正则匹配还是通用模板
            regex_result = regex_fallback_reply(comment_text, username)
            if regex_result:
                source_type = "regex_fallback"
            else:
                source_type = "fallback"
            stats[source_type] += 1
            log_reply(source_type, username, comment_text, work_full, reply_message,
                      success=False, error_reason="LLM失败，降级" if api_key else "无API Key，降级")

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

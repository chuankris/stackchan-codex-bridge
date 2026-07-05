#!/usr/bin/env python3
"""
M5t project-history MCP server.

This server exposes one MCP tool:
  - m5t_list_history_projects

It intentionally uses only the Python standard library so it can run on a
robot-side machine or a local bridge host without installing extra packages.
"""

from __future__ import annotations

import json
import os
import sys
from dataclasses import dataclass
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any
from urllib.parse import urlparse


SERVER_NAME = "m5t-project-history"
SERVER_VERSION = "0.1.0"
DEFAULT_HOST = "127.0.0.1"
DEFAULT_PORT = 8791
DEFAULT_PROJECTS_FILE = Path(__file__).parent / "data" / "m5t_projects.example.json"


TOOL_SCHEMA: dict[str, Any] = {
    "name": "m5t_list_history_projects",
    "description": "查询 M5t 机器人历史项目列表，支持按关键字、状态和数量过滤。",
    "inputSchema": {
        "type": "object",
        "properties": {
            "keyword": {
                "type": "string",
                "description": "可选。按项目名称、项目 ID、客户或备注做模糊搜索。",
            },
            "status": {
                "type": "string",
                "description": "可选。按项目状态过滤，例如 completed、running、paused、failed。",
            },
            "limit": {
                "type": "integer",
                "minimum": 1,
                "maximum": 100,
                "default": 20,
                "description": "返回项目数量上限。",
            },
        },
        "additionalProperties": False,
    },
}


@dataclass(frozen=True)
class JsonRpcResponse:
    payload: dict[str, Any]
    status_code: int = 200


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def projects_file() -> Path:
    configured = os.getenv("M5T_PROJECTS_FILE")
    if configured:
        return Path(configured).expanduser().resolve()
    return DEFAULT_PROJECTS_FILE


def read_json_file(path: Path) -> Any:
    try:
        with path.open("r", encoding="utf-8") as file:
            return json.load(file)
    except FileNotFoundError as exc:
        raise RuntimeError(f"projects file not found: {path}") from exc
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"projects file is not valid JSON: {path}: {exc}") from exc


def normalize_project(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "project_id": str(raw.get("project_id") or raw.get("id") or ""),
        "name": str(raw.get("name") or ""),
        "status": str(raw.get("status") or "unknown"),
        "customer": str(raw.get("customer") or ""),
        "robot": str(raw.get("robot") or "M5t"),
        "started_at": raw.get("started_at"),
        "updated_at": raw.get("updated_at"),
        "finished_at": raw.get("finished_at"),
        "summary": str(raw.get("summary") or ""),
        "tags": raw.get("tags") if isinstance(raw.get("tags"), list) else [],
    }


def load_projects() -> list[dict[str, Any]]:
    data = read_json_file(projects_file())
    if isinstance(data, dict):
        raw_projects = data.get("projects", [])
    elif isinstance(data, list):
        raw_projects = data
    else:
        raise RuntimeError("projects data must be a JSON array or an object with a projects array")

    if not isinstance(raw_projects, list):
        raise RuntimeError("projects must be a JSON array")

    projects: list[dict[str, Any]] = []
    for item in raw_projects:
        if isinstance(item, dict):
            projects.append(normalize_project(item))
    return projects


def project_matches_keyword(project: dict[str, Any], keyword: str) -> bool:
    searchable = " ".join(
        [
            project.get("project_id") or "",
            project.get("name") or "",
            project.get("customer") or "",
            project.get("summary") or "",
            " ".join(str(tag) for tag in project.get("tags", [])),
        ]
    ).lower()
    return keyword.lower() in searchable


def sort_key(project: dict[str, Any]) -> str:
    return str(project.get("updated_at") or project.get("finished_at") or project.get("started_at") or "")


def list_history_projects(arguments: dict[str, Any] | None) -> dict[str, Any]:
    args = arguments or {}
    keyword = str(args.get("keyword") or "").strip()
    status = str(args.get("status") or "").strip()
    limit = args.get("limit", 20)

    if not isinstance(limit, int):
        raise ValueError("limit must be an integer")
    if limit < 1 or limit > 100:
        raise ValueError("limit must be between 1 and 100")

    projects = load_projects()
    if keyword:
        projects = [project for project in projects if project_matches_keyword(project, keyword)]
    if status:
        projects = [project for project in projects if project.get("status", "").lower() == status.lower()]

    projects.sort(key=sort_key, reverse=True)
    selected = projects[:limit]

    return {
        "robot": "M5t",
        "count": len(selected),
        "total_matched": len(projects),
        "generated_at": utc_now(),
        "projects": selected,
    }


def json_rpc_error(request_id: Any, code: int, message: str, data: Any = None) -> dict[str, Any]:
    error: dict[str, Any] = {"code": code, "message": message}
    if data is not None:
        error["data"] = data
    return {"jsonrpc": "2.0", "id": request_id, "error": error}


def json_rpc_result(request_id: Any, result: dict[str, Any]) -> dict[str, Any]:
    return {"jsonrpc": "2.0", "id": request_id, "result": result}


def text_content(payload: dict[str, Any]) -> dict[str, Any]:
    return {
        "content": [
            {
                "type": "text",
                "text": json.dumps(payload, ensure_ascii=False, indent=2),
            }
        ]
    }


def handle_json_rpc(request: dict[str, Any]) -> JsonRpcResponse:
    request_id = request.get("id")
    method = request.get("method")
    params = request.get("params") or {}

    try:
        if method == "initialize":
            return JsonRpcResponse(
                json_rpc_result(
                    request_id,
                    {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {"tools": {}},
                        "serverInfo": {"name": SERVER_NAME, "version": SERVER_VERSION},
                    },
                )
            )

        if method == "notifications/initialized":
            return JsonRpcResponse({"jsonrpc": "2.0", "id": request_id, "result": {}})

        if method == "tools/list":
            return JsonRpcResponse(json_rpc_result(request_id, {"tools": [TOOL_SCHEMA]}))

        if method == "tools/call":
            tool_name = params.get("name")
            arguments = params.get("arguments") or {}
            if tool_name != TOOL_SCHEMA["name"]:
                return JsonRpcResponse(json_rpc_error(request_id, -32602, f"unknown tool: {tool_name}"))
            result = list_history_projects(arguments)
            return JsonRpcResponse(json_rpc_result(request_id, text_content(result)))

        return JsonRpcResponse(json_rpc_error(request_id, -32601, f"method not found: {method}"))
    except ValueError as exc:
        return JsonRpcResponse(json_rpc_error(request_id, -32602, str(exc)))
    except Exception as exc:
        return JsonRpcResponse(json_rpc_error(request_id, -32000, "tool execution failed", str(exc)))


class M5tMcpHandler(BaseHTTPRequestHandler):
    server_version = f"{SERVER_NAME}/{SERVER_VERSION}"

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path == "/healthz":
            self.send_json(
                {
                    "ok": True,
                    "name": SERVER_NAME,
                    "version": SERVER_VERSION,
                    "projectsFile": str(projects_file()),
                }
            )
            return

        if parsed.path == "/projects":
            try:
                self.send_json(list_history_projects({"limit": 20}))
            except Exception as exc:
                self.send_json({"ok": False, "error": str(exc)}, status_code=500)
            return

        self.send_json({"ok": False, "error": "not found"}, status_code=404)

    def do_POST(self) -> None:
        parsed = urlparse(self.path)
        if parsed.path != "/mcp":
            self.send_json({"ok": False, "error": "not found"}, status_code=404)
            return

        try:
            content_length = int(self.headers.get("content-length", "0"))
            body = self.rfile.read(content_length).decode("utf-8")
            request = json.loads(body)
        except Exception as exc:
            self.send_json(json_rpc_error(None, -32700, "parse error", str(exc)), status_code=400)
            return

        if isinstance(request, list):
            responses = [handle_json_rpc(item).payload for item in request if isinstance(item, dict)]
            self.send_json(responses)
            return

        if not isinstance(request, dict):
            self.send_json(json_rpc_error(None, -32600, "invalid request"), status_code=400)
            return

        response = handle_json_rpc(request)
        self.send_json(response.payload, status_code=response.status_code)

    def log_message(self, format_string: str, *args: Any) -> None:
        sys.stderr.write("%s - %s\n" % (self.address_string(), format_string % args))

    def send_json(self, payload: Any, status_code: int = 200) -> None:
        body = json.dumps(payload, ensure_ascii=False, indent=2).encode("utf-8")
        self.send_response(status_code)
        self.send_header("content-type", "application/json; charset=utf-8")
        self.send_header("content-length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)


def main() -> None:
    host = os.getenv("HOST", DEFAULT_HOST)
    port = int(os.getenv("PORT", str(DEFAULT_PORT)))
    server = ThreadingHTTPServer((host, port), M5tMcpHandler)
    print(f"{SERVER_NAME} listening on http://{host}:{port}/mcp", flush=True)
    print(f"projects file: {projects_file()}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()

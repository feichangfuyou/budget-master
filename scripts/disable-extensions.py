#!/usr/bin/env python3
"""Disable Cursor extensions by updating the state DB. Quit Cursor before running."""
import json
import sqlite3
import os

STATE_DB = os.path.expanduser(
    "~/Library/Application Support/Cursor/User/globalStorage/state.vscdb"
)

# Extensions to disable: not needed for TS/React/Python stack + redundant AI/heavy
DISABLED_IDS = [
    # Redundant AI (keep Cursor built-in + one; we keep anthropic.claude-code)
    "continue.continue",
    "saoudrizwan.claude-dev",
    "openai.chatgpt",
    # Heavy / Git History is enough
    "eamodio.gitlens",
    # Java
    "redhat.java",
    "vscjava.vscode-java-debug",
    "vscjava.vscode-java-test",
    # C# / .NET
    "anysphere.csharp",
    "muhammad-sammy.csharp",
    "ms-dotnettools.vscode-dotnet-runtime",
    # C/C++
    "anysphere.cpptools",
    "llvm-vs-code-extensions.vscode-clangd",
    "ms-vscode.cmake-tools",
    "ms-vscode.makefile-tools",
    "vadimcn.vscode-lldb",
    # Go, Rust, Dart/Flutter
    "golang.go",
    "rust-lang.rust-analyzer",
    "dart-code.dart-code",
    "dart-code.flutter",
    # Containers / K8s / SQL
    "ms-azuretools.vscode-docker",
    "ms-azuretools.vscode-containers",
    "ms-kubernetes-tools.vscode-kubernetes-tools",
    "ms-mssql.mssql",
    "mtxr.sqltools",
    # Other
    "ms-vscode.powershell",
    "builder.builder",
    "kombai.kombai",
    "ms-edgedevtools.vscode-edge-devtools",
    "firefox-devtools.vscode-firefox-debug",
    "ms-playwright.playwright",
    "revaturepro.revature-labs",
    "lirobi.phone-preview",
    "tomoki1207.pdf",
    "redhat.vscode-yaml",
    "github.vscode-github-actions",
]

def main():
    if not os.path.isfile(STATE_DB):
        print("Cursor state DB not found. Is Cursor installed?")
        return 1
    value = json.dumps(DISABLED_IDS)
    conn = sqlite3.connect(STATE_DB)
    try:
        conn.execute(
            "UPDATE ItemTable SET value = ? WHERE key = 'extensionsIdentifiers/disabled'",
            (value,),
        )
        if conn.total_changes == 0:
            conn.execute(
                "INSERT INTO ItemTable (key, value) VALUES ('extensionsIdentifiers/disabled', ?)",
                (value,),
            )
        conn.commit()
        print(f"Disabled {len(DISABLED_IDS)} extensions. Restart Cursor for changes to apply.")
    finally:
        conn.close()
    return 0

if __name__ == "__main__":
    exit(main())

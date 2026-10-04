#!/bin/bash
# Usage: run.sh <expname> <prompt> [extra claude args...]
set -u
export MSYS_NO_PATHCONV=1
name=$1; shift; prompt=$1; shift
d="$(cd "$(dirname "$0")" && pwd)/$name"
mkdir -p "$d"; cd "$d"
start=$(date +%s)
claude -p "$prompt" --plugin-dir ../../probe-plugin --setting-sources project,local --model sonnet --permission-mode bypassPermissions --output-format stream-json --verbose --include-hook-events "$@" > out${OUT:-}.jsonl 2> err${OUT:-}.txt
echo "exit=$? secs=$(( $(date +%s) - start ))"
node -e 'const fs=require("fs");const l=fs.readFileSync("out"+(process.env.OUT||"")+".jsonl","utf8").trim().split("\n").map(JSON.parse);const r=l.filter(x=>x.type==="result").pop();if(r)console.log("result:",r.subtype,"turns",r.num_turns,"cost",r.total_cost_usd.toFixed(4),"terminal",r.terminal_reason,"session",r.session_id)'

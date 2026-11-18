#!/bin/bash
#
# pre-push.d/20-deploy: 把部署交給 `inf deploy hook` (platform/inf)。
#
# git 沒有 post-push, inf 在背景等這次 push 落地, 再依 liva compose 決定要不要
# build + 推 registry + ssh rollout; 不在部署範圍的 repo 什麼都不做。
# 沒裝 inf 的機器直接略過; `|| true`: 舊版或壞掉的 inf 也不能擋下 push。

set -uo pipefail

command -v inf >/dev/null 2>&1 || exit 0
inf deploy hook --git-pid "${GIT_PUSH_PID:-$PPID}" "$@" || true
exit 0

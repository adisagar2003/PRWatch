# Manual end-to-end test

1. `npm run build && npm link` (makes `prw` available globally from this checkout).
2. Create a scratch repo: `gh repo create prwatch-e2e --private --clone && cd prwatch-e2e && git commit --allow-empty -m init && git push`.
3. `prw` → Repos → add `<you>/prwatch-e2e` → Agent → pick an installed agent → Quit.
4. In another terminal: `prw daemon` (leave running).
5. In the scratch repo: `git checkout -b test-pr && echo "x" > f.txt && git add . && git commit -m test && git push -u origin test-pr && gh pr create --fill`.
6. Within one poll interval (default 3 min) the daemon log (`~/.prwatch/logs/daemon.log`) shows `reviewing <you>/prwatch-e2e#1` then `posted review`.
7. Verify on GitHub: the PR has ONE comment starting with the review verdict (marker is invisible in rendered markdown).
8. Verify cleanup: `ls ~/.prwatch/cache` → empty.
9. Push a second commit to the same PR → daemon does NOT re-review (ledger + marker).
10. Cleanup: `gh repo delete <you>/prwatch-e2e --yes`, remove repo in `prw`.
11. Graceful shutdown: with `prw daemon` running and a review in progress, press Ctrl+C; verify the daemon exits, `ps` shows no orphaned agent processes, and the log contains `daemon stopping (SIGINT)`.

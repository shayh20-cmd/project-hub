---
description: Commit, push and deploy the hub (project_hub_01.html and the server) to Azure at kkarc-hub. Run only when the user says to deploy.
disable-model-invocation: true
argument-hint: "[what changed, for the commit message]"
---

Deploy the hub's current changes to https://kkarc-hub.azurewebsites.net. $ARGUMENTS describes
what changed; use it for the commit message.

1. **Level with origin first.** shayh20 pushes to master often, and deploying a stale checkout
   rolls their work off the live site. Run `git fetch origin` and `git status -sb`. If master is
   behind, `git pull --ff-only`. If it has diverged, stop and ask.
2. **Check.** Run `node --test "tests/*.test.js" "tools/spec-creator/test/*.test.js"` and
   `node tools/i18n-extract.js`. Stop on a failing test and show its output. If i18n-extract
   lists new untranslated Hebrew, add the English to `i18n-dict.js` first.
3. **Commit and push.** Stage only the files this work changed, by name. Never stage
   `project_hub_01.html.bak` or anything under `data/`. Write a conventional-commit message
   (`feat(project-hub): …`, `fix(lists): …`) from $ARGUMENTS and the diff, ending with the
   attribution line the session gives. Push to `origin master`.
4. **Deploy.** If `tools/local-server/node_modules` is missing, run `npm ci` there. Then, in
   PowerShell 7, run in the background: `.\Deploy-Azure.ps1 -Name kkarc-hub -CodeOnly`.
   Always pass `-CodeOnly`: configuration writes restart the app, and the free tier allows 15
   restarts an hour before Azure disables the site.
5. **Verify on the live site.** Easy Auth answers 401 to anything but a signed-in browser, so
   check in the browser pane: reload the live tab and look at the element that changed. If
   it fails, read the logs: `az webapp log tail --name kkarc-hub --resource-group project-hub`.
6. **Report** the commit hash, what went live, and what was checked on the live site.

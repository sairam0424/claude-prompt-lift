# Upgrading from prompt-master (0.3.x → 0.4.0)

Back to the [README](../README.md).

0.3.x was installed as `prompt-master@claude-prompt-master` from the marketplace `claude-prompt-master`. Both names changed: the plugin is `prompt-lift`, the marketplace `claude-prompt-lift`. The marketplace's `renames` map lets Claude Code recognise the old plugin name, but only inside the marketplace it already knows, and nothing moves your settings keys to `prompt-lift@claude-prompt-lift`: the options filed under `pluginConfigs["prompt-master@claude-prompt-master"]` — pinned `models` and `effortModels`, `skillExclude`, `prices`, the caps — do not apply to prompt-lift, which then runs on its defaults: the `fable,sonnet,haiku` aliases (on Bedrock, whatever the build maps them to, priced as the current generation), every skill, no caps. Move over in this order:

1. Copy your options first. Open `~/.claude/settings.json` and keep the `pluginConfigs` → `prompt-master@claude-prompt-master` → `options` block aside; `claude plugin configure prompt-master@claude-prompt-master` lists which options are set but not their values. Uninstalling the plugin or removing its marketplace deletes that block.
2. Remove the old marketplace: `claude plugin marketplace remove claude-prompt-master`. Claude Code uninstalls prompt-master with it and deletes what it saved, the options block included.
3. Add the new marketplace and install: `claude plugin marketplace add sairam0424/claude-prompt-lift` (or the path of your clone after `git pull`), then `claude plugin install prompt-lift@claude-prompt-lift`.
4. Put the options back under `pluginConfigs` → `prompt-lift@claude-prompt-lift` → `options` (settings file or `/config`), and check `enabledPlugins`: the new `prompt-lift@claude-prompt-lift` line must sit where the old one did, above any mod that draws the band without passing it through (see Limits in the [README](../README.md#limits)).
5. `/reload-plugins` (or start a new session), then `/prompt-lift status`: the `chain:` row must show the chain your options name (your pinned ids on Bedrock, see Bedrock users in the [README](../README.md#bedrock-users)); the aliases there mean the options did not move.

`status` day totals start at zero and `/prompt-lift model` is back on the configured chain: the 0.3.x rows and the stored model choice were saved under the old id and are not read.

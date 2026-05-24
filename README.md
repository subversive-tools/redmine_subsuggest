# Redmine Sublink Plugin

![Version](https://img.shields.io/badge/version-0.2.0-blue.svg)
![Redmine](https://img.shields.io/badge/Redmine-5.0%20%7C%206.0-red.svg?logo=redmine)
![License](https://img.shields.io/badge/license-MIT-green.svg)

A Redmine plugin that brings smart autocomplete and linking to every wiki text area — macros, mentions, and a powerful multi-level link builder.

> Built for teams who write a lot of Redmine text and want fast, discoverable links without remembering syntax.

## Features

- **`>>` — Smart Linker**: multi-level panel to build any link without knowing the syntax:
  - 🔗 **General links**: E-Mail (`mailto:`), Web URL, current page attachments
  - 📁 **Project → Issues**: cross-project issue links (`identifier#42`)
  - 📁 **Project → Members**: `@login` mentions
  - 📁 **Project → Wiki pages**: `[[identifier:Page]]` links
- **`{{` — Macro autocomplete**: type `{{` to get a dropdown of all available Redmine macros with descriptions and a full detail panel
- **`@` — Instant mention dropdown**: shows up immediately after `@` (no minimum character required), capped at 10 results for performance

All features work in **every wiki text area**: wiki pages, issue descriptions, issue notes, journal edits, news comments, forum messages, and project/document descriptions.

## Requirements

- Redmine 5.0 or higher

## Installation

> [!IMPORTANT]
> The plugin directory **MUST** be named `redmine_sublink` for the hook to load correctly.

1. **Clone** into your plugins directory:

   ```bash
   cd /path/to/redmine/plugins
   git clone https://github.com/subversive-tools/redmine_sublink.git redmine_sublink
   ```

2. **Restart Redmine** (no migrations required).

## Usage

### `{{` — Macro Autocomplete

Type `{{` anywhere in a wiki text area. A dropdown appears listing all available macros with a short description. Use arrow keys to navigate, `Tab` or `Enter` to insert.

The detail panel below the list shows the full macro description for the currently selected entry.

### `@` — Instant Mention

Type `@` at the start of a word. The member dropdown opens immediately (unlike Redmine's default which requires at least one character). Type to filter; only the first 10 members are shown.

### `>>` — Smart Linker

Type `>>` after a space or at the start of a line. A panel opens:

```
>> → [General Links]       → E-Mail / Weblink / Attachment
   → [Select Project]      → Issues / Members / Wiki pages
```

#### General Links

| Category | Type | Result |
|---|---|---|
| 📧 E-Mail | type address | `"addr":mailto:addr` |
| 🌐 Weblink | type URL (https:// added automatically) | `"example.com":https://example.com` |
| 📎 Anhang | lists attachments on the current issue/wiki page | `attachment:file.pdf` · `!attachment:img.png!` |

#### Project Links

| Category | Result |
|---|---|
| 🐛 Issues (current project) | `#42` |
| 🐛 Issues (other project) | `identifier#42` |
| 👤 Members | `@login` |
| 📄 Wiki (current project) | `[[Page Name]]` |
| 📄 Wiki (other project) | `[[identifier:Page Name]]` |

Press `Escape` to go one level back, or `Escape` at the top level to cancel (the `>>` is removed from the text).

## How It Works

The plugin injects a single `<style>` and `<script>` block into every Redmine page via a `ViewListener` hook. No JavaScript framework, no external dependencies. All assets are read from disk on each request — reloading the browser page is sufficient after updating the plugin files.

The project list is prefetched 2 seconds after page load so the Smart Linker panel opens instantly.

## Contributing

Contributions are welcome — please fork the repository and open a Pull Request.

1. Fork it
2. Create your feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes
4. Push to the branch
5. Open a Pull Request

## License

[MIT License](LICENSE) — Copyright (c) 2026 Stefan Mischke

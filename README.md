# Browser Toolbox

**English** | [简体中文](README.zh-CN.md)

Browser Toolbox builds on Vimium v2.4.2 keyboard navigation and adds mouse gestures, super drag,
wheel and rocker gestures, site rules, browser-startup actions, and a set of fully local utility
tools.

The current `manifest.json` version is `0.1.2`. This is the source version; it does not imply a
Chrome Web Store review or release status.

## Feature overview

| Module | What it provides |
| ------ | ---------------- |
| Keyboard navigation | Scrolling, link hints, search/bookmark/history/tab completion, find, marks, tab and window management, zoom, reload, and Vimium-compatible mappings |
| Mouse input | Four-direction gestures, multi-segment paths, super drag, wheel switching, rocker back/forward, and configurable commands |
| Browser workflow | Command center, action popup, current-site management, all-sites session pause/restore, and toolbar shortcuts |
| Local tools | JSON, Properties ↔ YAML, text diff, codec, time, ID, password, and CSV/TSV tools |
| Site controls | Glob/regex rules, match precedence, site profiles, per-module disablement, and rule explanations/tests |
| Configuration | Five languages, import preview, export backups, Vimium-compatible settings, migrations, and explicit sync boundaries |
| Privacy | No account, advertising, subscription, telemetry, or remote code; tools and settings are local by default |

## Install

Browser Toolbox currently targets Chrome or Chromium 117 and later. To install the development build:

1. Download and extract the [GitHub repository](https://github.com/ns3154/browser-toolbox).
2. Open `chrome://extensions` in the address bar.
3. Enable **Developer mode** in the top-right corner.
4. Select **Load unpacked**, then choose the project directory that contains `manifest.json`.
5. Select the extension icon in the browser toolbar, then choose **Open settings**.

Keyboard and mouse input cannot run on browser-managed pages such as `chrome://` pages or the Chrome
Web Store. You can still open **All tools**, Settings, and Help from the extension popup. To use
content features on `file://` pages, enable **Allow access to file URLs** in the extension details.

## Quick start

1. Open a regular web page and press `?` to see Help and the current keyboard actions.
2. Press `:` to open the Command center and search commands, tools, or settings.
3. Select the extension icon and open JSON Formatter or Text Diff from **Quick tools**.
4. Open Settings, enable the modules you want, change bindings, and select **Save**.
5. If a page conflicts with the extension, select **Pause all sites** in the popup and later select
   **Restore this session**. For a lasting change on one site, use **Manage this site** to create a
   Site Rule.

Under **General → Language**, choose English, 简体中文, 繁體中文, 日本語, Español, or **Follow
browser**.

## Keyboard navigation

Browser Toolbox retains Vimium's keyboard workflow and exposes commands through a searchable command
registry:

- Use `h` / `j` / `k` / `l`, `gg` / `G`, `d` / `u`, and directional commands to scroll.
- Use `f` / `F` for link hints, opening links in the current tab, a foreground new tab, or other
  configured targets; link copying and downloading are also available.
- Use `o` / `O` for the Vomnibar to search URLs, bookmarks, history, and open tabs; search engines
  are configurable.
- Use `T` to search open tabs, `H` / `L` to go back or forward, and `J` / `K` to switch tabs.
- Use `t`, `x` / `X`, and `r` / `R` to create, close, restore, and reload; use `zi` / `zo` / `z0`
  for zoom.
- Use `/`, `n` / `N` for find, `m` / `'` for page marks, and `yy` to copy the current URL.
- Tab pinning, muting, moving, duplication, side-based closing, window management, view source,
  and fullscreen commands are available as well.

Common defaults:

| Key | Action |
| --- | ------ |
| `?` | Open Help |
| `:` | Open the Command center |
| `h` / `j` / `k` / `l` | Scroll left / down / up / right |
| `gg` / `G` | Scroll to the top / bottom |
| `f` / `F` | Open a link in the current tab / a new tab |
| `o` / `O` | Search or open URLs, bookmarks, and history in the current tab / a new tab |
| `T` | Search open tabs |
| `H` / `L` | Go back / forward |
| `J` / `K` | Switch to the previous / next tab |
| `t` | Open a new tab |
| `x` / `X` | Close / restore a tab |
| `/`, `n` / `N` | Find text and jump to the next / previous match |
| `yy` | Copy the current URL |
| `Esc` | Cancel the current action or leave input mode |

Help reflects customized bindings. The **Keyboard** settings accept Vimium-compatible mappings;
keyboard mappings and search engines continue to use Vimium's existing browser-sync behavior.

## Mouse gestures

### Mouse trails

Mouse gestures use the right button and four-direction recognition by default. Hold the right button,
move up, down, left, or right, and release to run an action. Multi-segment gestures use `·` as a
separator. The trigger button, activation and sample distances, turn hysteresis, maximum segments,
duration, trail, and command feedback are configurable.

| Gesture | Default action |
| ------- | -------------- |
| `←` | Go back |
| `→` | Go forward |
| `↑` / `↓` | Page up / page down |
| `↓ · →` | Close the current tab |
| `← · ↑` | Restore the most recently closed tab |
| `→ · ↓` / `→ · ↑` | Scroll to the bottom / top |
| `↑ · ↓` / `↑ · ↓ · ↑` | Reload / hard reload |
| `↑ · ←` / `↑ · →` | Switch to the previous / next tab |
| `↓ · → · ↑` / `↑ · → · ↓` | Open a new window / close the current window |
| `→ · ↓ · ← · ↑` | Open Browser Toolbox settings |

When right-button context-menu capture is enabled, hold and move to perform a gesture. Without
moving, right-click twice quickly in the same location to open the browser's native menu. Normal
click behavior is preserved when no gesture is recognized.

### Super drag

Hold the left button while dragging a link, selected text, or an image, move in a configured
direction, and release:

| Target | Direction | Default action |
| ------ | --------- | -------------- |
| Link | `→` / `←` | Open in the current tab / a background new tab |
| Selected text | `→` / `←` | Search in the foreground / background |
| Selected text | `↓` | Copy text |
| Image | `→` / `←` | Open in the current tab / a background new tab |
| Image | `↓` | Copy the image URL |
| Image | `↓ · →` | Download the image |

Hold `Alt` while dragging to preserve native browser drag behavior. Super drag does not take over
file uploads, editors, password fields, or other protected controls.

### Wheel and rocker gestures

- Hold the right button and scroll up / down to go to the top / bottom of the page.
- Hold the left button and scroll up / down to switch to the previous / next tab.
- Hold the right button and click the left button to go back.
- Hold the left button and click the right button to go forward.

Wheel threshold, cooldown, and continuous tab switching are configurable. Unbound combinations keep
normal click or wheel behavior; mouse gestures take priority when features share a trigger button.

## Command center, popup, and session controls

- **Command center**: press `:` or open it from the extension popup to search browser commands, local
  tools, and settings. Press `Enter` to run a result and `Esc` to close.
- **Action popup**: shows current-site status, current-session switches for the four browsing
  enhancement modules, quick tools, Command center, All tools, Help, and Settings.
- **Session pause**: pause keyboard, mouse, super-drag, and wheel enhancements on all sites for the
  current session. Restoring the session returns to saved settings and Site Rules; temporary switches
  do not overwrite persistent configuration.
- **Manage this site**: from a regular page, open Settings for the current origin or prepare a new
  rule draft; changes take effect only after saving.
- **Restricted pages**: when the browser blocks content scripts, the popup explains why while keeping
  tool, Settings, and Help entry points available.

## Local tools

Select **All tools** from the extension popup, or search for a tool in the Command center:

| Tool | Capabilities |
| ---- | ------------ |
| JSON formatter | Format, compact, validate, sort, and expand escaped JSON; indentation, repair, copy, and download options |
| Properties ↔ YAML | Convert both ways, with explicit errors for paths, types, nulls, and unsupported syntax |
| Text diff | Compare two local texts and copy the result |
| Codec transform | Unicode, Base64, URL/URI, JSON/XML, binary, octal, decimal, ASCII, Data URL, and compatibility digest operations |
| Time converter | ISO time, Unix seconds/milliseconds, timezone display, Windows FILETIME, and world clock |
| ID generator | UUID v4, ULID-style, Snowflake-style, and NanoID-style IDs; generate 1, 5, or 10 values |
| Password generator | Generate 12-, 20-, 32-, or 64-character random passwords with optional symbols |
| CSV / TSV converter | Convert to Markdown, CSV, TSV, JSON, XML, MySQL `INSERT`, or PHP arrays |

Tool inputs are processed locally in the browser, with copy and, where applicable, download actions.
The tool directory shows categories, keywords, and entry points. **Tool overview** independently
configures action-popup and native context-menu tools; any number of eligible tools can be selected,
with no product-level three- or six-item cap. The context menu includes only tools that support that
surface; ID and password generators remain available from the action popup and Command center.

### Document auto-formatting

Enable document auto-formatting under **JSON Formatter** to format matching JSON, XML, CSS,
JavaScript, and Java documents. Each format can be toggled independently. Configure the maximum
automatic input size, JSON key sorting, and default collapse depth. Matching document content is read
locally and is not uploaded.

## Browser-startup website

Under **General → Browser startup**, enable **Open a website when Chrome starts** and enter an
`http://` or `https://` URL.

- It opens at most once each time the Chrome profile starts.
- It creates an active tab in the focused normal window, then the first normal window, or creates a
  normal window if none exists.
- Existing tabs restored by Chrome are kept; Chrome's home page and new-tab page are not changed.
- `file:`, `javascript:`, `data:`, `chrome:`, and other non-HTTP(S) schemes are rejected, and no
  behavior is promised for an incognito-profile startup event.

This is a browser-startup action, not a new-tab redirect. The
[newtab-redirect](https://github.com/jimschubert/newtab-redirect) project is a reference for the
different `chrome_url_overrides` behavior.

## Settings and configuration

The Settings page is organized into these panels:

| Panel | Contents |
| ----- | -------- |
| General | Global switch, command feedback, toolbox sync, language, and browser-startup website |
| Keyboard | Keyboard module and Vimium-compatible mappings |
| Tool overview | Tool switch, action popup, context menu, tool directory, and search |
| JSON formatter | Document auto-formatting and JSON defaults |
| Content diff | Text diff tool settings and entry |
| Encoding & conversion | Codec tool settings and entry |
| Time & IDs | Time, ID, and password tool settings and entry |
| Search | Search engines and search settings |
| Appearance | Local PNG custom pointer, hotspot coordinates, and preview |
| Mouse Gestures | Trail recognition, actions, context-menu behavior, and feedback |
| Super Drag | Link, text, and image actions plus native bypass modifier |
| Wheel & Rocker | Wheel threshold, cooldown, tab switching, and rocker actions |
| Site Rules | Glob/regex matching, module switches, profiles, precedence, and rule tests |
| Privacy | Local processing, network boundary, no-telemetry promise, and license |
| Backup & About | Import preview, export, defaults, onboarding, and third-party notices |

### Site Rules and profiles

Site Rules support Glob patterns and explicit regular expressions. Matching uses specificity,
precedence, and configuration order to compute the final state. You can test a URL, inspect the
matching explanation, disable Browser Toolbox on a site, or disable only mouse, super drag, wheel,
and other modules. Built-in profiles include:

- **Balanced**: standard thresholds for everyday browsing.
- **Editor safe**: reduces accidental gestures in editors and design tools.
- **Reading**: reduces input feedback while reading for a long time.
- **Custom profile**: overrides only selected fields and inherits the rest from global settings.

### Import, export, and sync

- Export files contain settings only; they do not contain page content, history, bookmarks, temporary
  session overrides, or remote resources.
- Preview changes before importing. Browser Toolbox settings and compatible Vimium JSON backups are
  supported; unknown fields are reported and incompatible fields are ignored.
- The settings schema migrates forward step by step and fills new defaults for older settings.
- **Sync toolbox settings** applies to Browser Toolbox mouse behavior, tools, and Site Rules. Keyboard
  mappings and search engines keep Vimium's existing sync behavior.
- Chrome sync has per-item and total-size limits. Shorten the configuration or disable toolbox sync
  to keep the settings local if the limit is reached.

## Privacy, permissions, and network behavior

- The official version is free forever, with no advertising, account, subscription, paid feature, or
  feature lock.
- Browser Toolbox does not add telemetry, device fingerprinting, install-source statistics, remote
  configuration, or crash reporting.
- Local tools, gesture paths, page content, and settings are processed in the browser and are not
  uploaded to a project server.
- Network activity is limited to user-initiated navigation, explicit searches, project links, and
  browser extension updates. Search terms are sent to the selected search engine only when the user
  explicitly runs a search command.
- The extension does not load remote JavaScript, remote fonts, or CDN runtime code.
- See [`docs/permissions.md`](docs/permissions.md) for each permission,
  [`PRIVACY.md`](PRIVACY.md) for the privacy policy, and
  [`THIRD_PARTY_NOTICES.md`](THIRD_PARTY_NOTICES.md) for third-party notices.

## Project status, license, and feedback

The current version is in compatibility, accessibility, and pre-release acceptance. Automated tests
do not replace independent acceptance on Windows, Edge, Chrome Stable, authenticated sites, screen
readers, or the Chrome Web Store.

New project code follows [GPL-3.0-or-later](LICENSE). Files retained or modified from Vimium keep
their original MIT copyright and license notices. See [`PROJECT_CHARTER.md`](PROJECT_CHARTER.md) for
project boundaries and [`CONTRIBUTING.md`](CONTRIBUTING.md) for contribution guidance.

Report problems or suggest improvements in [Browser Toolbox issues](https://github.com/ns3154/browser-toolbox/issues).
Include the extension version, browser version, operating system, and steps to reproduce.

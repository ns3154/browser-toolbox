# Browser Toolbox

**English** | [简体中文](README.zh-CN.md)

Browse the web, search, manage tabs, and work with text and data using keyboard shortcuts, mouse
gestures, and local tools.

## Install

To install from [GitHub](https://github.com/ns3154/browser-toolbox):

1. Download and extract this repository.
2. Open `chrome://extensions` in Chrome or Chromium.
3. Enable **Developer mode** in the top-right corner.
4. Select **Load unpacked**, then choose the project directory that contains `manifest.json`.
5. Select the extension icon in the browser toolbar, then choose **Open settings**.

Keyboard and mouse navigation cannot run on browser-managed pages such as `chrome://` pages or the
Chrome Web Store. You can still open **All tools** and Settings from the extension icon.

## Quick start

1. Open a regular web page and press `?` to see the available keyboard shortcuts.
2. On a long page, hold the right mouse button, move down, and release to scroll down one page.
3. Select the extension icon, open **All tools**, and try formatting JSON or comparing two texts.
4. If a page's own controls conflict with the extension, select **Pause all sites**, then use
   **Restore this session** when ready. Session controls apply to all sites; use **Site Rules** for
   a lasting exception on one site.

Use **Open settings** to change actions, then select **Save**. Under **General → Language**, choose
English, 简体中文, 繁體中文, 日本語, Español, or **Follow browser**.

## Local tools

Open **All tools** from the extension icon, then search or choose a tool:

| Tool                | Use it to                                                 |
| ------------------- | --------------------------------------------------------- |
| JSON formatter      | Format, validate, sort, or compact JSON                   |
| Properties ↔ YAML   | Convert configuration text between Properties and YAML    |
| Text diff           | Find differences between two texts                        |
| Codec transform     | Encode or decode text, such as Base64 and URL values      |
| Time converter      | Convert timestamps, dates, and time zones                 |
| ID generator        | Generate UUIDs and other common IDs                       |
| Password generator  | Generate random passwords with a chosen length            |
| CSV / TSV converter | Convert tabular text to Markdown, JSON, and other formats |

These tools process input locally in the browser. In tool settings, choose any number of shortcuts for
the popup and any of the supported tools for the browser's right-click menu. Select text on a web
page and use a configured context-menu entry to send it to that tool.

## Command center

Press `:` on a regular web page, or select **Command center** from the extension icon. Search for
commands, tools, and settings, use `↑` / `↓` to choose, and press `Enter` to open or run the result.
Press `Esc` to close it.

## Common keyboard shortcuts

| Key                   | Action                                                    |
| --------------------- | --------------------------------------------------------- |
| `?`                   | Open Help                                                 |
| `h` / `j` / `k` / `l` | Scroll left / down / up / right                           |
| `gg` / `G`            | Scroll to the top / bottom of the page                    |
| `f` / `F`             | Show link hints and open in the current / a new tab       |
| `o` / `O`             | Search or open URLs, bookmarks, and history               |
| `T`                   | Search open tabs                                          |
| `H` / `L`             | Go back / forward                                         |
| `J` / `K`             | Switch to the previous / next tab                         |
| `t`                   | Open a new tab                                            |
| `x` / `X`             | Close / restore a tab                                     |
| `/`, `n` / `N`        | Find text and jump to the next / previous match           |
| `yy`                  | Copy the current URL                                      |
| `Esc`                 | Cancel the current action or leave the current input mode |

Help reflects your customized bindings. The table above lists common defaults.

## Mouse gestures

Mouse gestures use the right button and four-direction recognition by default. Hold the right
button, move up, down, left, or right, and release to run the action. Multi-segment gestures use `·`
as a separator.

| Gesture                   | Default action                               |
| ------------------------- | -------------------------------------------- |
| `←`                       | Go back                                      |
| `→`                       | Go forward                                   |
| `↑` / `↓`                 | Page up / page down                          |
| `↓ · →`                   | Close the current tab                        |
| `← · ↑`                   | Restore the most recently closed tab         |
| `→ · ↓` / `→ · ↑`         | Scroll to the bottom / top                   |
| `↑ · ↓`                   | Reload the page                              |
| `↑ · ↓ · ↑`               | Hard reload the page                         |
| `↑ · ←` / `↑ · →`         | Switch to the previous / next tab            |
| `↓ · → · ↑` / `↑ · → · ↓` | Open a new window / close the current window |
| `→ · ↓ · ← · ↑`           | Open Browser Toolbox settings                |

When right-button context-menu capture is enabled, hold and move to perform a gesture. Without
moving, right-click twice quickly in the same location to open the browser's native context menu.
You can change the trigger button, trail visibility, and action bindings in Settings.

## Super drag

Hold the left button while dragging a link, selected text, or image, move in a configured direction,
and release to run an action. The default actions are:

| Target        | Direction | Default action                                 |
| ------------- | --------- | ---------------------------------------------- |
| Link          | `→` / `←` | Open in the current tab / a background new tab |
| Selected text | `→` / `←` | Search in the foreground / background          |
| Selected text | `↓`       | Copy text                                      |
| Image         | `→` / `←` | Open in the current tab / a background new tab |
| Image         | `↓`       | Copy the image URL                             |
| Image         | `↓ · →`   | Download the image                             |

Hold `Alt` while dragging to preserve the browser's native drag behavior. Super drag does not take
over file uploads, editors, password fields, or other protected controls.

## Wheel and rocker gestures

- Hold the right button and scroll up / down to go to the top / bottom of the page.
- Hold the left button and scroll up / down to switch to the previous / next tab.
- Hold the right button and click the left button to go back.
- Hold the left button and click the right button to go forward.

Unbound combinations retain normal click or wheel behavior. Mouse gestures take priority when
multiple mouse features share the same trigger button.

## Settings

Select **Open settings** from the extension menu to:

- Enable keyboard navigation, change shortcuts, and configure search engines under **Navigation &
  Keyboard**.
- Enable mouse features and add or edit gesture, super-drag, wheel, and rocker actions under **Mouse
  & Drag**.
- Show or hide trails and command feedback, or select a local PNG pointer under **Appearance &
  Behavior**.
- Set URL rules and choose a **Balanced**, **Editor safe**, **Reading**, or custom profile under
  **Site Rules**. A profile can adjust gesture sensitivity and feedback for a specific site.
- Export settings or preview and import an existing settings file under **Backup & Restore**.

Select **Save** after changing settings.

To adjust the current website, choose **Manage this site** in the popup. This opens an existing rule
for the site's origin or prepares a new rule; review it and select **Save** to apply it. **Restore
this session** clears temporary overrides and returns to your saved settings and site rules.

The browser sync switch applies to Browser Toolbox settings, including mouse behavior, tools, and
site rules. Custom keyboard mappings and search engines retain Vimium's browser sync behavior. If
the toolbox settings exceed the sync limit, shorten the configuration or turn off toolbox sync and
save locally. Export a backup before moving settings to another browser.

## Feedback

Report problems or suggest improvements in
[Browser Toolbox issues](https://github.com/ns3154/browser-toolbox/issues). Include the extension
version, browser version, and steps to reproduce the problem.

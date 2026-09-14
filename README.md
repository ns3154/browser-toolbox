# Browser Toolbox

**English** | [简体中文](README.zh-CN.md)

Browse the web, search, and manage tabs and windows with keyboard and mouse workflows.

## Install

Browser Toolbox is currently available from GitHub:

1. Download and extract this repository.
2. Open `chrome://extensions` in Chrome or Chromium.
3. Enable **Developer mode** in the top-right corner.
4. Select **Load unpacked**, then choose the project directory that contains `manifest.json`.
5. Select the extension icon in the browser toolbar, then choose **Open settings**.

Extensions cannot run on browser-managed pages such as `chrome://` pages or the Chrome Web Store.
Use Browser Toolbox on regular web pages.

## Quick start

- Press `?` on a web page to open Help and view all available shortcuts.
- Select the extension icon to see the current site's status and temporarily toggle keyboard
  navigation, mouse gestures, super drag, and wheel/rocker gestures.
- Use **Open settings** to change features and action bindings, then select **Save**.

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
button, move up, down, left, or right, and release to run the action. Multi-segment gestures use
`·` as a separator.

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
- Enable Browser Toolbox by URL or disable individual mouse modules for a site under **Site Rules**.
- Export settings or preview and import an existing settings file under **Backup & Restore**.

Select **Save** after changing settings.

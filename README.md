# Prism hero

An animated landing-page hero: a spinning rhombus splitting light into a fan of silky ribbons (WebGL), with drifting
sparkles and a draggable gem. Plain HTML, CSS and JavaScript, with no build step.

## Run

Open `index.html` in a browser, or serve the folder (for example `python3 -m http.server`).

## Tuning the look

Open the page with `?edit` to show the editor panel (top-left). The setting is remembered in your browser; open the page
with `?edit=0` to hide the panel again.

Changes apply live and are saved in your browser. Press **Copy settings** and paste the result over `Prism.defaults` in
`constants.js` to make them the new defaults for everyone. **Reset** goes back to the defaults.

## Files

| File           | What it holds                                                               |
| -------------- | --------------------------------------------------------------------------- |
| `constants.js` | Default values of every setting                                             |
| `settings.js`  | Editor labels and allowed ranges for each setting (also used to validate)   |
| `shader.js`    | GLSL for the ribbons and the rhombus                                        |
| `hero.js`      | Rendering, animation, drag and drop; exposes `Prism.hero` (get, set, reset) |
| `editor.js`    | The `?edit` panel                                                           |
| `styles.css`   | Page and editor styles, including the no-WebGL fallback                     |

Formatting: [Prettier](https://prettier.io) with `.prettierrc.json` (`npx prettier --write .`).

# Модуль imaging — сборка карточек товара

Берёт фото часов на белом фоне (как их присылает поставщик), вырезает объект и
ставит его в фирменную тёмную сцену с тенью и отражением. Вверху — команды,
схема конвейера и что нужно для подключения к боту; правила, грабли и причины —
ниже, «Доводы и история решений».

## Команды

```bash
npm run image:fetch-model        # один раз: скачать веса (~170 МБ)

npx ts-node scripts/compose-product-image.ts --in=photos/ --out=cards/
npx ts-node scripts/compose-product-image.ts --in=g-shock.jpg --out=cards/ --debug
```

`--in` принимает файл или каталог (без рекурсии). Прочие аргументы описаны в
шапке `scripts/compose-product-image.ts`.

## Как это работает

```
фото на белом
  ├─ background-removal.service  isnet-general-use (ONNX) → маска
  ├─ mask-refine                 снятие каймы фона, подрезка хвостов маски
  ├─ geometry                    вписывание в бокс, посадка на линию контакта
  └─ scene-composer              фон → тень → отражение → товар
готовая карточка
```

## Подключение к боту

Сейчас модуль — набор функций и класс без декораторов. Для бота понадобится:
обернуть в `@Injectable()` + `ImagingModule`, держать `BackgroundRemover`
синглтоном (сессия ONNX загружается один раз) и увести обработку в очередь Bull —
она упирается в процессор и в хендлере будет держать бота. Что ещё поменять в
зависимостях и образе — последний пункт «Доводов».

## Доводы и история решений

> Перенесено из корневого `CLAUDE.md` (2026-10-18), чтобы он не грузил в каждую сессию то, что нужно
> только при работе в этом модуле. Сюда же слиты правила и грабли, которые раньше повторялись в верхней
> части README по-русски; вверху остались команды, схема конвейера и план подключения к боту.

### Product cards (`src/modules/imaging`) — CLI only, off the live path

Takes a supplier's photo of a watch on white, cuts the object out and stands it in the branded dark
scene with a shadow and a reflection. Reached only through `scripts/compose-product-image.ts`; it is
in no Nest module and the bot does not call it. The core is plain functions **because** the bot is
the next step — wrapping in `@Injectable()` must not mean rewriting.

- **The cutout is a segmentation model, not a threshold on white** (`isnet-general-use`, ONNX, local,
  ~170 MB in `assets/models/`, gitignored). A luma threshold cuts a black G-Shock fine and falls
  apart on a steel bracelet: highlights on polished steel are indistinguishable from the background,
  and the gaps between links need clearing separately from the outer contour. The model is
  **discriminative** — it answers "object or background" and draws nothing. A generative "enhancer"
  would be free to rewrite the dial lettering, and the defect would surface at the buyer.
- **Preprocessing constants are checked against rembg's sources** (`sessions/base.py`,
  `sessions/dis_general_use.py`), not written from memory: a wrong mean/std does not crash, it
  quietly degrades the mask and reads as "the model is bad". The same for the min-max stretch of the
  output and for taking output **0**, channel **0** — isnet has side decoder heads.
- **The white fringe is subtracted, not masked.** An edge pixel is a mixture of object and
  background; invisible on white, a glowing contour on the dark scene. The background is known, so
  the mixture resolves exactly: `F = (C − BG·(1 − α)) / α` (`mask-refine.ts`, подробности — в шапке файла). This is why the
  module is worth having at all rather than a two-line ImageMagick call.
- **sharp returns a one-channel raw buffer as THREE channels.** The mask coming out of `resize` is
  expanded to sRGB, so the buffer is three times longer than declared, rows shear, and the mask
  arrives striped with a spreading fan — with no error, because sharp does not check the length.
  `toColourspace('b-w')` fixes it and the length is asserted explicitly (чтобы в следующий раз это падало, а не
  косило картинку). `extractChannel('alpha')`,
  by contrast, does return one channel. This cost a debugging session; the symptom points at the
  model and the preprocessing, which are innocent.
- **A blurred shadow is clipped by its own canvas**, so the canvas is extended by three sigmas
  _before_ `blur`, and whatever leaves the frame is cut by `clipToCanvas` — shifting the layer inwards
  would move the shadow out from under the object.
- **Полупрозрачный лоскут белого фона там, где модель не уверена**, читается на тёмной сцене как светлый
  призрак. Срезается порогом `--alpha-floor` (0.2–0.3); платой идёт чуть более резкий край. Смотреть удобно
  вместе с `--debug`, который кладёт рядом маску и вырезанный объект.
- Scene numbers live in a **JSON preset** (`assets/scenes/*.json`, Joi-validated, unknown keys
  rejected — чтобы опечатка не выглядела как «параметр почему-то дефолтный»), not in the composer: a background
  is a consumable — второй шаблон означает второй JSON в `assets/scenes`, а не правку композитора. Схема и
  значения по умолчанию — в `scene-preset.ts`. Все доли считаются от размера канвы, чтобы пресет пережил замену
  шаблона на тот же кадр в другом разрешении. `reflection.maxHeight` exists because
  `fade` is measured from the object while the podium's depth is not — without a cap, a tall watch on
  a strap reflects off the podium onto the backdrop.
- **The template PNG is committed** (2 MB) so the module works from a fresh clone; only the weights
  are fetched. The preset's numbers were fitted **by eye** against that template — `anchor.y` is the
  contact line on the podium's top face — and verified on a live G-Shock photo. A different
  background means fitting them again: where the surface is is only visible on the picture. Удобно так — сделать
  несколько JSON с разными `fit`/`anchor` и прогнать одно фото через каждый, сравнив результаты рядом. CLI
  проверяет наличие и фона, и модели до обхода файлов и говорит, чего не хватает.
- **The model must not be downloaded at runtime once this moves into the bot.** Prod is on a Russian
  host where external domains are as unreachable as `api.telegram.org` (ровно поэтому в проекте есть
  `TELEGRAM_API_URL`) — the file goes into the image via `COPY` at build time.
- **`onnxruntime-node` and `sharp` are `devDependencies`, and the module is excluded from
  `tsconfig.build.json`** — the prod image contains neither the packages nor `dist/modules/imaging`.
  This is not tidying: `onnxruntime-node` ships **258 MB of binaries inside the npm package** and its
  postinstall downloads the CUDA EP nupkg on top, and on 05-08-2026 that download is what failed the
  deploy with `ENOSPC` while the host was already full. The builder stage sets
  `ONNXRUNTIME_NODE_INSTALL=skip` (the package's own flag, `script/install.js`) so the GPU fetch never
  runs — nuget.org is an external domain and no more reachable from Moscow than `api.telegram.org`.
  - Nothing was lost in prod, because nothing worked there: `assets/` is not copied into the image at
    all and `assets/models` (170 MB) is gitignored, so the module had neither weights nor scenes.
  - Before the exclude, `nest build` emitted `dist/modules/imaging/*.js` with live
    `require('onnxruntime-node')` — resolvable nowhere in the runner, and harmless only because no
    file requires them. The first accidental import would have been a runtime crash in prod.
  - `tsconfig.json` still includes the module, so `npm run typecheck` keeps checking its types; CI
    installs devDependencies. Only `imaging-scene.test.ts` needs `sharp`; no test touches
    `onnxruntime-node`. Локально нужен полный `npm ci` (без `--omit=dev`), иначе команды CLI не запустятся.
  - **Moving this into the bot means moving both packages back into `dependencies`** and copying
    `assets/` into the image (убрать строку из `exclude` и добавить `COPY assets` в `Dockerfile`) — say it out
    loud here, because the exclude above will otherwise look
    like a decision to keep the module out of prod forever rather than until it is wired in.

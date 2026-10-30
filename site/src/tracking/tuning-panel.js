const STRINGS = {
  ru: {
    summary: 'Чувствительность',
    headLabel: 'Поворот головы',
    headHelp: 'Меньше значение — меньше нужно поворачивать голову для срабатывания.',
    delayLabel: 'Время на возврат головы',
    delayHelp: 'Пауза после шага. Верните голову в удобную позу; после паузы удержите её неподвижно до снятия блокировки.',
    strictLabel: 'Строгость моргания',
    strictHelp: 'Правее — требуется более полное закрытие глаз',
    invertLabel: 'Инверсия влево/вправо',
    invertHelp: 'Если поворот влево выбирает правую клавишу, переключите инверсию.',
    doubleStepAngleLabel: 'Двойной вбок',
    doubleStepVerticalAngleLabel: 'Двойной кивок',
    doubleStepVerticalAngleHelp: 'Наклон головы вверх или вниз на этот угол перемещает выделение сразу на две клавиши. Автоповтора нет.',
    doubleStepAngleHelp: 'Независимый угол: одно движение головой перемещает выделение сразу на две клавиши. Автоповтора нет.',
    reset: 'Сбросить',
    unitDeg: '°',
    unitMs: 'мс',
    unitPercent: '%',
    storageWarning: 'Хранилище недоступно. Настройки действуют до перезапуска.',
    error: 'Не удалось применить настройки. Текущие значения сохранены.',
    unavailable: 'Настройки недоступны.'
  },
  uk: {
    summary: 'Чутливість',
    headLabel: 'Поворот голови',
    headHelp: 'Менше значення — менше потрібно повертати голову для спрацювання.',
    delayLabel: 'Час на повернення голови',
    delayHelp: 'Пауза після кроку. Поверніть голову у зручну позу; після паузи тримайте її нерухомо до зняття блокування.',
    strictLabel: 'Суворість моргання',
    strictHelp: 'Правіше — потрібне повніше закриття очей',
    invertLabel: 'Інверсія вліво/вправо',
    invertHelp: 'Якщо поворот ліворуч вибирає праву клавішу, перемкніть інверсію.',
    doubleStepAngleLabel: 'Подвійний вбік',
    doubleStepVerticalAngleLabel: 'Подвійний кивок',
    doubleStepVerticalAngleHelp: 'Нахил голови вгору або вниз на цей кут переміщує виділення одразу на дві клавіші. Автоповтору немає.',
    doubleStepAngleHelp: 'Незалежний кут: один рух головою переміщує виділення одразу на дві клавіші. Автоповтору немає.',
    reset: 'Скинути',
    unitDeg: '°',
    unitMs: 'мс',
    unitPercent: '%',
    storageWarning: 'Сховище недоступне. Налаштування діють до перезапуску.',
    error: 'Не вдалося застосувати налаштування. Поточні значення збережено.',
    unavailable: 'Налаштування недоступні.'
  },
  en: {
    summary: 'Sensitivity',
    headLabel: 'Head turn',
    headHelp: 'Lower values require less head movement to trigger.',
    delayLabel: 'Time to return the head',
    delayHelp: 'Pause after a step. Return to a comfortable pose; after the pause, hold it still until navigation unlocks.',
    strictLabel: 'Blink strictness',
    strictHelp: 'Further right — a fuller eyelid closure is required',
    invertLabel: 'Invert left/right',
    invertHelp: 'If a left turn selects the right key, toggle this option.',
    doubleStepAngleLabel: 'Double sideways',
    doubleStepVerticalAngleLabel: 'Double up/down',
    doubleStepVerticalAngleHelp: 'Tilting your head up or down by this angle moves the selection two keys at once. It never auto-repeats.',
    doubleStepAngleHelp: 'Independent angle: one head movement moves the selection two keys at once. It never auto-repeats.',
    reset: 'Reset',
    unitDeg: '°',
    unitMs: 'ms',
    unitPercent: '%',
    storageWarning: 'Storage is unavailable. Settings last until restart.',
    error: 'Could not apply settings. Current values are kept.',
    unavailable: 'Settings are unavailable.'
  },
  de: {
    summary: 'Empfindlichkeit',
    headLabel: 'Kopfdrehung',
    headHelp: 'Kleinere Werte erfordern weniger Kopfbewegung zum Auslösen.',
    delayLabel: 'Zeit für die Kopfrückkehr',
    delayHelp: 'Pause nach einem Schritt. Kehren Sie in eine bequeme Haltung zurück; halten Sie den Kopf nach der Pause still, bis die Navigation freigegeben wird.',
    strictLabel: 'Blinzelstrenge',
    strictHelp: 'Weiter rechts — ein vollständigeres Schließen der Augenlider ist nötig',
    invertLabel: 'Links/rechts umkehren',
    invertHelp: 'Wählt eine Linksdrehung die rechte Taste, schalten Sie diese Option um.',
    doubleStepAngleLabel: 'Doppelt seitlich',
    doubleStepVerticalAngleLabel: 'Doppelt vertikal',
    doubleStepVerticalAngleHelp: 'Eine Kopfneigung nach oben oder unten um diesen Winkel verschiebt die Auswahl in einer Bewegung um zwei Tasten. Es gibt keine automatische Wiederholung.',
    doubleStepAngleHelp: 'Unabhängiger Winkel: Eine Kopfbewegung verschiebt die Auswahl um zwei Tasten. Keine automatische Wiederholung.',
    reset: 'Zurücksetzen',
    unitDeg: '°',
    unitMs: 'ms',
    unitPercent: '%',
    storageWarning: 'Speicher nicht verfügbar. Einstellungen gelten bis zum Neustart.',
    error: 'Einstellungen konnten nicht angewendet werden. Aktuelle Werte bleiben erhalten.',
    unavailable: 'Einstellungen sind nicht verfügbar.'
  },
  es: {
    summary: 'Sensibilidad',
    headLabel: 'Giro de cabeza',
    headHelp: 'Los valores más bajos requieren menos movimiento de cabeza para activarse.',
    delayLabel: 'Tiempo para volver la cabeza',
    delayHelp: 'Pausa tras un paso. Vuelva a una postura cómoda; después de la pausa, mantenga la cabeza quieta hasta que se desbloquee la navegación.',
    strictLabel: 'Rigor del parpadeo',
    strictHelp: 'Más a la derecha — se exige un cierre más completo de los párpados',
    invertLabel: 'Invertir izquierda/derecha',
    invertHelp: 'Si al girar a la izquierda se selecciona la tecla derecha, cambie esta opción.',
    doubleStepAngleLabel: 'Doble lateral',
    doubleStepVerticalAngleLabel: 'Doble vertical',
    doubleStepVerticalAngleHelp: 'Inclinar la cabeza hacia arriba o hacia abajo este ángulo mueve la selección dos teclas de una vez. No se repite automáticamente.',
    doubleStepAngleHelp: 'Ángulo independiente: un movimiento de cabeza mueve la selección dos teclas. No se repite automáticamente.',
    reset: 'Restablecer',
    unitDeg: '°',
    unitMs: 'ms',
    unitPercent: '%',
    storageWarning: 'El almacenamiento no está disponible. Los ajustes duran hasta reiniciar.',
    error: 'No se pudieron aplicar los ajustes. Se mantienen los valores actuales.',
    unavailable: 'Los ajustes no están disponibles.'
  },
  pt: {
    summary: 'Sensibilidade',
    headLabel: 'Viragem da cabeça',
    headHelp: 'Valores mais baixos exigem menos movimento da cabeça para ativar.',
    delayLabel: 'Tempo para voltar a cabeça',
    delayHelp: 'Pausa após um passo. Volte a uma posição confortável; após a pausa, mantenha a cabeça parada até a navegação ser desbloqueada.',
    strictLabel: 'Rigor da piscadela',
    strictHelp: 'Mais à direita — é necessário um fecho mais completo das pálpebras',
    invertLabel: 'Inverter esquerda/direita',
    invertHelp: 'Se virar à esquerda seleciona a tecla da direita, altere esta opção.',
    doubleStepAngleLabel: 'Duplo lateral',
    doubleStepVerticalAngleLabel: 'Duplo vertical',
    doubleStepVerticalAngleHelp: 'Inclinar a cabeça para cima ou para baixo este ângulo move a seleção duas teclas de uma vez. Nunca repete automaticamente.',
    doubleStepAngleHelp: 'Ângulo independente: um movimento da cabeça move a seleção duas teclas. Nunca repete automaticamente.',
    reset: 'Repor',
    unitDeg: '°',
    unitMs: 'ms',
    unitPercent: '%',
    storageWarning: 'O armazenamento não está disponível. As definições duram até reiniciar.',
    error: 'Não foi possível aplicar as definições. Os valores atuais são mantidos.',
    unavailable: 'As definições não estão disponíveis.'
  },
  it: {
    summary: 'Sensibilità',
    headLabel: 'Rotazione della testa',
    headHelp: 'Valori più bassi richiedono meno movimento della testa per attivarsi.',
    delayLabel: 'Tempo per riportare la testa',
    delayHelp: 'Pausa dopo un passo. Torni in una posa comoda; dopo la pausa, tenga la testa ferma fino allo sblocco della navigazione.',
    strictLabel: 'Rigore del battito',
    strictHelp: 'Più a destra — è richiesta una chiusura più completa delle palpebre',
    invertLabel: 'Inverti sinistra/destra',
    invertHelp: 'Se girando a sinistra si seleziona il tasto a destra, cambi questa opzione.',
    doubleStepAngleLabel: 'Doppio laterale',
    doubleStepVerticalAngleLabel: 'Doppio verticale',
    doubleStepVerticalAngleHelp: 'Inclinare la testa verso l’alto o il basso di questo angolo sposta la selezione di due tasti in un solo movimento. Non si ripete automaticamente.',
    doubleStepAngleHelp: 'Angolo indipendente: un movimento della testa sposta la selezione di due tasti. Non si ripete automaticamente.',
    reset: 'Ripristina',
    unitDeg: '°',
    unitMs: 'ms',
    unitPercent: '%',
    storageWarning: 'Archiviazione non disponibile. Le impostazioni restano fino al riavvio.',
    error: 'Impossibile applicare le impostazioni. I valori attuali sono mantenuti.',
    unavailable: 'Le impostazioni non sono disponibili.'
  }
};

const FIELD_CONFIG = [
  {name: 'headAngleDeg', min: 1, max: 12, step: 0.5, decimals: 1, labelKey: 'headLabel', helpKey: 'headHelp', unitKey: 'unitDeg'},
  {name: 'doubleStepAngleDeg', min: 1, max: 24, step: 0.5, decimals: 1, labelKey: 'doubleStepAngleLabel', helpKey: 'doubleStepAngleHelp', unitKey: 'unitDeg', doubleStepOnly: true},
  {name: 'doubleStepVerticalAngleDeg', min: 1, max: 24, step: 0.5, decimals: 1, labelKey: 'doubleStepVerticalAngleLabel', helpKey: 'doubleStepVerticalAngleHelp', unitKey: 'unitDeg', doubleStepOnly: true},
  {name: 'reactionDelayMs', min: 0, max: 1500, step: 50, decimals: 0, labelKey: 'delayLabel', helpKey: 'delayHelp', unitKey: 'unitMs'},
  {name: 'blinkStrictness', min: 0, max: 100, step: 5, decimals: 0, labelKey: 'strictLabel', helpKey: 'strictHelp', unitKey: 'unitPercent', blinkOnly: true}
];

const STYLE_ID = 'tracking-tuning-style';
const STYLE_TEXT = `
  .tracking-tuning {
    grid-column: 1 / -1;
    min-width: 0;
    margin: 0;
    border: 1px solid var(--border);
    border-radius: 12px;
    background: #ffffff;
    color: var(--text);
  }
  .tracking-tuning > summary {
    min-height: 44px;
    padding: 12px 14px;
    font: 700 16px/1.25 Arial, sans-serif;
    overflow-wrap: anywhere;
    cursor: pointer;
    touch-action: manipulation;
  }
  .tracking-tuning[open] > summary {
    border-bottom: 1px solid var(--border);
  }
  .tracking-tuning > summary:focus-visible {
    outline: 3px solid #087dff;
    outline-offset: -3px;
  }
  .tracking-tuning-body {
    display: grid;
    gap: 10px;
    min-width: 0;
    padding: 12px 14px 14px;
  }
  .tracking-tuning-grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
    gap: 12px;
    min-width: 0;
  }
  .tracking-tuning-control[hidden] {
    display: none !important;
  }
  .tracking-tuning-control {
    display: grid;
    gap: 6px;
    min-width: 0;
  }
  .tracking-tuning-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 8px;
    min-width: 0;
  }
  .tracking-tuning-label {
    min-width: 0;
    font: 700 15px/1.25 Arial, sans-serif;
    overflow-wrap: anywhere;
    hyphens: auto;
  }
  .tracking-tuning-output {
    flex: none;
    font: 700 15px/1.25 Arial, sans-serif;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }
  .tracking-tuning-help {
    color: #3a3a3c;
    font: 500 13px/1.3 Arial, sans-serif;
    overflow-wrap: anywhere;
    hyphens: auto;
  }
  .tracking-tuning input[type=range] {
    width: 100%;
    min-width: 0;
    min-height: 44px;
    margin: 0;
    accent-color: #0a84ff;
  }
  .tracking-tuning input[type=range]:focus-visible {
    outline: 3px solid #087dff;
    outline-offset: 2px;
  }
  .tracking-tuning-actions {
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 10px;
    min-width: 0;
  }
  .tracking-tuning-invert-control {
    display: grid;
    gap: 4px;
    min-width: 0;
  }
  .tracking-tuning-invert {
    display: flex;
    align-items: center;
    gap: 8px;
    min-width: 0;
    min-height: 44px;
    font: 700 15px/1.25 Arial, sans-serif;
    overflow-wrap: anywhere;
    cursor: pointer;
    touch-action: manipulation;
  }
  .tracking-tuning-invert input[type=checkbox] {
    flex: none;
    width: 22px;
    height: 22px;
    margin: 0;
    accent-color: #0a84ff;
  }
  .tracking-tuning-invert input[type=checkbox]:focus-visible {
    outline: 3px solid #087dff;
    outline-offset: 2px;
  }
  .tracking-tuning-invert-label {
    min-width: 0;
    overflow-wrap: anywhere;
    hyphens: auto;
  }
  .tracking-tuning-invert-help {
    max-width: 34ch;
  }
  .tracking-tuning button.tracking-tuning-reset {
    min-width: 44px;
    min-height: 44px;
    padding: 8px 16px;
    border: 1px solid var(--border);
    border-radius: 10px;
    background: var(--control-bg);
    color: var(--text);
    font: 700 15px/1.2 Arial, sans-serif;
    cursor: pointer;
    touch-action: manipulation;
  }
  .tracking-tuning button.tracking-tuning-reset:active {
    background: #cfcfd4;
  }
  .tracking-tuning button.tracking-tuning-reset:focus-visible {
    outline: 3px solid #087dff;
    outline-offset: 2px;
  }
  .tracking-tuning-status {
    margin: 0;
    text-align: center;
    font: 600 13px/1.3 Arial, sans-serif;
    overflow-wrap: anywhere;
  }
  .tracking-tuning-status[data-tone=warning] {
    color: #8a5a00;
  }
  .tracking-tuning-status[data-tone=error] {
    color: #b00020;
  }
  @media (max-width: 560px) {
    .tracking-tuning-grid {
      grid-template-columns: 1fr;
    }
    .tracking-tuning-actions {
      display: grid;
    }
    .tracking-tuning button.tracking-tuning-reset {
      width: 100%;
    }
  }
  /* Hidden help remains referenced by aria-describedby; title provides pointer help. */
  .tracking-tuning-help {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
`;

let instanceCounter = 0;

function ensureStyle() {
  let style = document.getElementById(STYLE_ID);
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.append(style);
  }
  if (style.textContent !== STYLE_TEXT) style.textContent = STYLE_TEXT;
}

function hasOwn(object, key) {
  return object !== null && object !== undefined && Object.prototype.hasOwnProperty.call(object, key);
}

function numericValue(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const number = Number(value);
    return Number.isFinite(number) ? number : null;
  }
  return null;
}

function formatNumber(value, decimals, locale) {
  try {
    return new Intl.NumberFormat(locale, {
      maximumFractionDigits: decimals,
      minimumFractionDigits: 0,
      useGrouping: false
    }).format(value);
  } catch (error) {
    return String(value);
  }
}

function asSettings(value) {
  if (!value || typeof value !== 'object') return null;
  if (value.values && typeof value.values === 'object') return value;
  if (value.trackingSettings && typeof value.trackingSettings === 'object') {
    return asSettings(value.trackingSettings);
  }
  return null;
}

function looksLikeStorageIssue(error) {
  const code = typeof error === 'string' ? error : error && (error.code || error.name || error.message);
  return typeof code === 'string' && /(quota|denied|storage|corrupt|persist)/i.test(code);
}

export function initTuningPanel(app) {
  const dialog = document.getElementById('settingsDialog');
  const settingsBody = dialog ? dialog.querySelector('.settings-body') : null;
  if (!dialog || !settingsBody) throw new Error('TUNING_SETTINGS_BODY_REQUIRED');
  ensureStyle();
  const instanceId = `tracking-tuning-${++instanceCounter}`;
  const details = document.createElement('details');
  details.className = 'tracking-tuning';
  // Expanded by default inside the settings dialog so sliders are directly available.
  details.open = true;
  const summary = document.createElement('summary');
  summary.className = 'tracking-tuning-summary';
  details.append(summary);
  const body = document.createElement('div');
  body.className = 'tracking-tuning-body';
  details.append(body);
  const grid = document.createElement('div');
  grid.className = 'tracking-tuning-grid';
  body.append(grid);
  const status = document.createElement('div');
  status.className = 'tracking-tuning-status';
  status.id = `${instanceId}-status`;
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.setAttribute('aria-atomic', 'true');
  status.hidden = true;
  body.append(status);
  const actions = document.createElement('div');
  actions.className = 'tracking-tuning-actions';
  const invertControl = document.createElement('div');
  invertControl.className = 'tracking-tuning-invert-control';
  const invertId = `${instanceId}-invertHorizontal`;
  const invertLabel = document.createElement('label');
  invertLabel.className = 'tracking-tuning-invert';
  invertLabel.htmlFor = invertId;
  const invertInput = document.createElement('input');
  invertInput.type = 'checkbox';
  invertInput.id = invertId;
  invertInput.name = 'invertHorizontal';
  invertInput.disabled = true;
  const invertText = document.createElement('span');
  invertText.className = 'tracking-tuning-invert-label';
  invertLabel.append(invertInput, invertText);
  const invertHelp = document.createElement('div');
  invertHelp.className = 'tracking-tuning-help tracking-tuning-invert-help';
  invertHelp.id = `${invertId}-help`;
  invertInput.setAttribute('aria-describedby', invertHelp.id);
  invertControl.append(invertLabel, invertHelp);
  const resetButton = document.createElement('button');
  resetButton.type = 'button';
  resetButton.className = 'tracking-tuning-reset';
  resetButton.disabled = true;
  actions.append(invertControl, resetButton);
  body.append(actions);

  const fields = FIELD_CONFIG.map(config => {
    const control = document.createElement('div');
    control.className = 'tracking-tuning-control';
    const head = document.createElement('div');
    head.className = 'tracking-tuning-head';
    const inputId = `${instanceId}-${config.name}`;
    const label = document.createElement('label');
    label.className = 'tracking-tuning-label';
    label.htmlFor = inputId;
    const output = document.createElement('output');
    output.className = 'tracking-tuning-output';
    output.setAttribute('for', inputId);
    head.append(label, output);
    const input = document.createElement('input');
    input.type = 'range';
    input.id = inputId;
    input.name = config.name;
    input.min = String(config.min);
    input.max = String(config.max);
    input.step = String(config.step);
    input.disabled = true;
    const help = document.createElement('div');
    help.className = 'tracking-tuning-help';
    help.id = `${inputId}-help`;
    input.setAttribute('aria-describedby', help.id);
    control.append(head, input, help);
    grid.append(control);
    return {config, control, label, output, input, help};
  });

  function placeTuningPanel() {
    const headPanel = settingsBody.querySelector('#headOptionsPanel');
    if (headPanel) {
      if (details.previousElementSibling !== headPanel) headPanel.after(details);
      return;
    }
    const bridgePanel = settingsBody.querySelector('.bridge-panel');
    if (bridgePanel) {
      if (details.nextElementSibling !== bridgePanel) bridgePanel.before(details);
      return;
    }
    if (details.parentNode !== settingsBody) settingsBody.append(details);
  }
  placeTuningPanel();
  // App startup awaits input settings before creating the tracking panel, so
  // the modal order is stable and needs no observer or second mount lifecycle.
  details.addEventListener('click', event => event.stopPropagation());

  let statusMode = null;
  let pending = Object.create(null);
  let flushTimer = null;
  let latestRequestId = '';
  let requestSerial = 0;

  const hasPending = name => hasOwn(pending, name);

  function nextRequestId() {
    requestSerial += 1;
    return `${instanceId}-request-${requestSerial}`;
  }

  function getLocale() {
    try {
      const state = app.getState();
      const locale = state && state.settings && state.settings.uiLocale;
      return typeof locale === 'string' && hasOwn(STRINGS, locale) ? locale : 'ru';
    } catch (error) {
      return 'ru';
    }
  }

  function strings() {
    return STRINGS[getLocale()] || STRINGS.ru;
  }

  function formatField(field, value) {
    const text = strings();
    const number = formatNumber(value, field.config.decimals, getLocale());
    const unit = text[field.config.unitKey];
    if (field.config.unitKey === 'unitMs') return `${number} ${unit}`;
    return `${number}${unit}`;
  }

  function updateOutput(field, keepWhenDisabled = false) {
    const value = numericValue(field.input.value);
    if (value === null || (field.input.disabled && !keepWhenDisabled)) {
      if (field.output.textContent !== '') field.output.textContent = '';
      field.input.removeAttribute('aria-valuetext');
      return;
    }
    const text = formatField(field, value);
    if (field.output.textContent !== text) field.output.textContent = text;
    field.input.setAttribute('aria-valuetext', text);
  }

  function renderStatus() {
    const text = strings();
    let message = '';
    let tone = '';
    if (statusMode === 'storage') {
      message = text.storageWarning;
      tone = 'warning';
    } else if (statusMode === 'error') {
      message = text.error;
      tone = 'error';
    } else if (statusMode === 'unavailable') {
      message = text.unavailable;
    }
    if (status.textContent !== message) status.textContent = message;
    status.hidden = message === '';
    if (tone) status.dataset.tone = tone;
    else status.removeAttribute('data-tone');
  }

  function setStatus(mode) {
    statusMode = mode || null;
    renderStatus();
  }

  function applyOwner(settings, options = {}) {
    const source = applySource();
    const blinkVisible = source === 'blink';
    const values = settings && settings.values;
    if (!values || typeof values !== 'object') {
      for (const field of fields) {
        field.input.disabled = true;
        updateOutput(field);
      }
      invertInput.disabled = true;
      resetButton.disabled = true;
      setStatus('unavailable');
      return;
    }
    const preservePending = options.preservePending !== false;
    const doubleStepOn = values.doubleStepEnabled === true;
    for (const field of fields) {
      if (field.config.blinkOnly && !blinkVisible) {
        field.input.disabled = true;
        updateOutput(field);
        continue;
      }
      const value = numericValue(values[field.config.name]);
      if (value === null) continue;
      const keepWhenDisabled = field.config.doubleStepOnly === true;
      const fieldDisabled = keepWhenDisabled && !doubleStepOn;
      if (preservePending && hasPending(field.config.name)) {
        field.input.disabled = fieldDisabled;
        updateOutput(field, keepWhenDisabled);
        continue;
      }
      if (field.input.value !== String(value)) field.input.value = String(value);
      field.input.disabled = fieldDisabled;
      updateOutput(field, keepWhenDisabled);
    }
    if (typeof values.invertHorizontal === 'boolean') {
      invertInput.disabled = false;
      if (invertInput.checked !== values.invertHorizontal) invertInput.checked = values.invertHorizontal;
    } else {
      invertInput.disabled = true;
    }
    resetButton.disabled = !fields.some(field => !field.input.disabled) && invertInput.disabled;
    if (options.preserveStatus !== true) {
      if (settings.storageIssue) setStatus('storage');
      else if (statusMode === 'storage' || statusMode === 'unavailable' || statusMode === 'error') setStatus(null);
    }
  }

  function currentClickSource() {
    try {
      const state = app.getState();
      const source = state && state.inputSettings && state.inputSettings.values && state.inputSettings.values.clickSource;
      return source === 'blink' || source === 'external' || source === 'mouth' ? source : 'mouth';
    } catch (error) {
      return 'mouth';
    }
  }

  function applySource() {
    const source = currentClickSource();
    details.dataset.source = source;
    for (const field of fields) {
      if (!field.config.blinkOnly) continue;
      field.control.hidden = source !== 'blink';
    }
    return source;
  }

  function readSettings() {
    try {
      const state = app.getState();
      return asSettings(state && state.trackingSettings);
    } catch (error) {
      return null;
    }
  }

  function dispatch(command, payload) {
    try {
      return Promise.resolve(app.dispatch(command, payload));
    } catch (error) {
      return Promise.reject(error);
    }
  }

  function clearPending() {
    pending = Object.create(null);
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  }

  function queueField(field) {
    const value = numericValue(field.input.value);
    if (value === null) return;
    pending[field.config.name] = value;
    updateOutput(field);
  }

  function scheduleFlush() {
    if (flushTimer !== null) clearTimeout(flushTimer);
    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, 100);
  }

  function send(command, payload, id, options) {
    dispatch(command, payload).then(result => {
      if (id !== latestRequestId) return;
      const owner = readSettings() || asSettings(result);
      if (owner) applyOwner(owner, options);
      else setStatus('unavailable');
    }).catch(error => {
      if (id !== latestRequestId) return;
      if (options && options.restoreOnError) {
        const owner = readSettings();
        if (owner) applyOwner(owner, {preservePending: true, preserveStatus: true});
      }
      setStatus(looksLikeStorageIssue(error) ? 'storage' : 'error');
    });
  }

  function flush() {
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    const names = Object.keys(pending);
    if (names.length === 0) return;
    const values = Object.create(null);
    for (const name of names) values[name] = pending[name];
    pending = Object.create(null);
    const id = nextRequestId();
    latestRequestId = id;
    const payload = {requestId: id};
    for (const name of names) payload[name] = values[name];
    send('tracking.settings.update', payload, id, {preservePending: true});
  }

  function resetSettings() {
    clearPending();
    const id = nextRequestId();
    latestRequestId = id;
    send('tracking.settings.update', {requestId: id, reset: true}, id, {preservePending: true});
  }

  function localize() {
    applySource();
    const text = strings();
    details.lang = getLocale();
    summary.textContent = text.summary;
    for (const field of fields) {
      field.label.textContent = text[field.config.labelKey];
      field.help.textContent = text[field.config.helpKey];
      field.label.title = text[field.config.helpKey];
      field.input.title = text[field.config.helpKey];
      updateOutput(field);
    }
    invertText.textContent = text.invertLabel;
    invertHelp.textContent = text.invertHelp;
    invertInput.title = text.invertHelp;
    invertLabel.title = text.invertHelp;
    resetButton.textContent = text.reset;
    renderStatus();
  }

  function refresh() {
    const owner = readSettings();
    if (owner) {
      applyOwner(owner, {preservePending: true});
      return;
    }
    let result;
    try {
      result = app.dispatch('tracking.settings.get', {});
    } catch (error) {
      setStatus('unavailable');
      return;
    }
    Promise.resolve(result).then(settings => {
      const next = readSettings() || asSettings(settings);
      if (next) applyOwner(next, {preservePending: true});
      else setStatus('unavailable');
    }).catch(() => setStatus('unavailable'));
  }

  fields.forEach(field => {
    field.input.addEventListener('input', () => {
      queueField(field);
      scheduleFlush();
    });
    field.input.addEventListener('change', flush);
    field.input.addEventListener('blur', flush);
  });

  invertInput.addEventListener('click', event => event.stopPropagation());
  invertInput.addEventListener('change', () => {
    const id = nextRequestId();
    latestRequestId = id;
    send('tracking.settings.update', {requestId: id, invertHorizontal: invertInput.checked}, id, {
      preservePending: true,
      restoreOnError: true
    });
  });

  resetButton.addEventListener('click', event => {
    event.stopPropagation();
    resetSettings();
  });

  window.addEventListener('keyboardtrackingsettings', refresh);
  window.addEventListener('keyboardinputsettings', refresh);
  window.addEventListener('keyboardlocalize', localize);

  localize();
  refresh();
  return {refresh};
}

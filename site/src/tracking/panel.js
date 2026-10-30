/* The user surface joins camera/FSM owners to the existing keyboard command owner.
   This module never stores text or records video, landmarks or biometric history. */
import {TrackingEngine} from './engine.js';
import {HeadBlinkController} from './controller.js';
import {initTuningPanel} from './tuning-panel.js';

const STRINGS = {
  ru: ["Камера", "Остановить", "Нейтраль головы", "Камера выключена", "Запуск камеры…", "Смотрите на клавиатуру в удобной позе. Несколько секунд держите голову спокойно.", "Поворачивайте голову вправо, влево, вверх или вниз. Моргните для нажатия.", "Лицо не видно — ввод приостановлен", "Недостаточная уверенность — ввод приостановлен", "Моргните: будет одно нажатие выделенной клавиши.", "Ошибка камеры или модели. Повторите запуск", "Включите камеру кнопкой на странице", "Пауза", "Настройка нейтрали необходима"],
  uk: ["Камера", "Зупинити", "Нейтраль голови", "Камеру вимкнено", "Запуск камери…", "Дивіться на клавіатуру в зручній позі. Кілька секунд тримайте голову спокійно.", "Повертайте голову праворуч, ліворуч, угору або вниз. Моргніть для натискання.", "Обличчя не видно — введення призупинено", "Недостатня впевненість — введення призупинено", "Моргніть: буде одне натискання виділеної клавіші.", "Помилка камери або моделі. Повторіть запуск", "Увімкніть камеру кнопкою на сторінці", "Пауза", "Потрібне налаштування нейтралі"],
  en: ["Camera", "Stop", "Neutral head pose", "Camera off", "Starting camera…", "Look at the keyboard comfortably. Keep your head still for a few seconds.", "Turn your head right, left, up or down. Blink to press the selected key.", "Face not visible — input paused", "Low confidence — input paused", "Blink to press the highlighted key once.", "Camera or model error. Start again", "Use the camera button on this page", "Paused", "Neutral calibration required"],
  de: ["Kamera", "Stoppen", "Neutrale Kopfhaltung", "Kamera aus", "Kamera startet…", "Blicken Sie bequem auf die Tastatur. Halten Sie den Kopf kurz ruhig.", "Bewegen Sie den Kopf nach rechts, links, oben oder unten. Blinzeln zum Drücken.", "Gesicht nicht sichtbar — Eingabe pausiert", "Geringe Sicherheit — Eingabe pausiert", "Blinzeln Sie, um die markierte Taste einmal zu drücken.", "Kamera- oder Modellfehler. Erneut starten", "Kamera über die Schaltfläche dieser Seite starten", "Pausiert", "Neutrale Kopfhaltung kalibrieren"],
  es: ["Cámara", "Detener", "Posición neutra", "Cámara apagada", "Iniciando cámara…", "Mire el teclado cómodamente. Mantenga la cabeza quieta unos segundos.", "Mueva la cabeza a derecha, izquierda, arriba o abajo. Parpadee para pulsar.", "Rostro no visible — entrada en pausa", "Baja confianza — entrada en pausa", "Parpadee para pulsar una vez la tecla resaltada.", "Error de cámara o modelo. Inicie de nuevo", "Use el botón de cámara de esta página", "En pausa", "Calibre la posición neutra"],
  pt: ["Câmara", "Parar", "Posição neutra", "Câmara desligada", "A iniciar a câmara…", "Olhe confortavelmente para o teclado. Mantenha a cabeça imóvel alguns segundos.", "Mova a cabeça para a direita, esquerda, cima ou baixo. Pisque para premir.", "Rosto não visível — entrada em pausa", "Baixa confiança — entrada em pausa", "Pisque para premir uma vez a tecla destacada.", "Erro da câmara ou modelo. Inicie novamente", "Use o botão de câmara nesta página", "Em pausa", "Calibre a posição neutra"],
  it: ["Fotocamera", "Ferma", "Posizione neutra", "Fotocamera spenta", "Avvio della fotocamera…", "Guardi comodamente la tastiera. Tenga la testa ferma per qualche secondo.", "Muova la testa a destra, sinistra, in alto o in basso. Batta le palpebre per premere.", "Viso non visibile — inserimento in pausa", "Bassa affidabilità — inserimento in pausa", "Batta le palpebre per premere una volta il tasto evidenziato.", "Errore di fotocamera o modello. Riavvii", "Usi il pulsante fotocamera su questa pagina", "In pausa", "Calibrare la posizione neutra"]
};

const CONTROL_ERROR = {
  ru:'Ошибка управления клавишей. Перенастройте нейтраль головы.',
  uk:'Помилка керування клавішею. Налаштуйте нейтраль голови знову.',
  en:'Key control failed. Recalibrate the neutral head pose.',
  de:'Tastensteuerung fehlgeschlagen. Neutrale Kopfhaltung neu kalibrieren.',
  es:'Falló el control de la tecla. Recalibre la posición neutra.',
  pt:'Falha no controlo da tecla. Calibre novamente a posição neutra.',
  it:'Controllo del tasto non riuscito. Ricalibri la posizione neutra.'
};

function publicError(code) {
  const error = new Error(code);
  error.code = code;
  return error;
}

// Each row: open, closed, asymmetric, waiting, detected, typed, rejected, fallback;
// then the rejection reasons in REJECT_KEYS order. These are current diagnostics,
// not a saved eye signal or biometric history.
const REJECT_KEYS = ['not_armed','too_short','too_long','face_lost','selection_changed','modal_open','cooldown','callback_failed','moving','low_confidence','one_eye'];
const TRANSITION_EYES = {
  ru:'Состояние глаз уточняется', uk:'Стан очей уточнюється', en:'Checking eye state',
  de:'Augenzustand wird geprüft', es:'Comprobando el estado de los ojos',
  pt:'A verificar o estado dos olhos', it:'Verifica dello stato degli occhi'
};
const EYE_UNRELIABLE = {
  ru:'Глаза видны недостаточно уверенно — ввод приостановлен',
  uk:'Очі видно недостатньо впевнено — введення призупинено',
  en:'Eye signal is unreliable — input paused',
  de:'Augensignal unzuverlässig — Eingabe pausiert',
  es:'Señal de ojos poco fiable — entrada en pausa',
  pt:'Sinal dos olhos pouco fiável — entrada em pausa',
  it:'Segnale degli occhi non affidabile — inserimento in pausa'
};
const RETURN_CENTER = {
  ru:'Вернитесь ближе к исходной удобной позе головы',
  uk:'Поверніться ближче до початкової зручної пози голови',
  en:'Return closer to your initial comfortable head pose',
  de:'Kehren Sie näher zur anfänglichen bequemen Kopfhaltung zurück',
  es:'Vuelva cerca de la posición cómoda inicial de la cabeza',
  pt:'Volte para perto da posição inicial confortável da cabeça',
  it:'Torni vicino alla posizione comoda iniziale della testa'
};
const TURN_SIGNAL = {
  ru:'во время поворота сигнал глаз был неоднозначным',
  uk:'під час повороту сигнал очей був неоднозначним',
  en:'eye signal was ambiguous during the turn',
  de:'Augensignal während der Drehung mehrdeutig',
  es:'señal de ojos ambigua durante el giro',
  pt:'sinal dos olhos ambíguo durante a rotação',
  it:'segnale degli occhi ambiguo durante la rotazione'
};
const EYE_REFERENCE = {
  ru:'Проверка глаз в новой позе. Держите глаза обычно открытыми.',
  uk:'Перевірка очей у новій позі. Тримайте очі звично відкритими.',
  en:'Checking eyes in this pose. Keep them normally open.',
  de:'Augenprüfung in dieser Haltung. Augen normal offen halten.',
  es:'Comprobando ojos en esta postura. Manténgalos abiertos normalmente.',
  pt:'A verificar os olhos nesta posição. Mantenha-os normalmente abertos.',
  it:'Verifica degli occhi in questa posa. Li tenga normalmente aperti.'
};
const LOOKING_DOWN = {
  ru:'Взгляд вниз',uk:'Погляд униз',en:'Looking down',de:'Blick nach unten',
  es:'Mirando hacia abajo',pt:'A olhar para baixo',it:'Sguardo verso il basso'
};
const NAV_TEXT = {
  ru: {ready:'Голова в исходном положении — переключения доступны', locked:'Возврат головы — переключения заблокированы', hold:'Удержите удобную позу', remaining:'осталось {seconds} с'},
  uk: {ready:'Голова у вихідному положенні — перемикання доступні', locked:'Повернення голови — перемикання заблоковані', hold:'Утримайте зручну позу', remaining:'залишилося {seconds} с'},
  en: {ready:'Head at neutral — switches available', locked:'Returning head — switching is blocked', hold:'Hold a comfortable pose', remaining:'{seconds} s remaining'},
  de: {ready:'Kopf in Neutralstellung — Umschalten verfügbar', locked:'Kopf zurückführen — Umschalten blockiert', hold:'Bequeme Haltung halten', remaining:'noch {seconds} s'},
  es: {ready:'Cabeza en neutro — cambio disponible', locked:'Volviendo la cabeza — cambio bloqueado', hold:'Mantenga una postura cómoda', remaining:'quedan {seconds} s'},
  pt: {ready:'Cabeça na posição neutra — mudança disponível', locked:'A voltar a cabeça — mudança bloqueada', hold:'Mantenha uma posição confortável', remaining:'faltam {seconds} s'},
  it: {ready:'Testa in posizione neutra — cambio disponibile', locked:'Ritorno della testa — cambio bloccato', hold:'Mantenga una posa comoda', remaining:'mancano {seconds} s'}
};
const BLINK_TEXT = {
  ru: {prefix:'Моргание', ready:'готово', reasons:{camera_paused:'камера на паузе', face_lost:'лицо не видно', eye_reference:'проверка глаз', eyes_unreliable:'сигнал глаз ненадёжен', head_motion:'движение головы', eye_posture:'положение глаз', closed:'глаза закрыты', modal_open:'открыты настройки'}},
  uk: {prefix:'Моргання', ready:'готове', reasons:{camera_paused:'камера на паузі', face_lost:'обличчя не видно', eye_reference:'перевірка очей', eyes_unreliable:'сигнал очей ненадійний', head_motion:'рух голови', eye_posture:'положення очей', closed:'очі закриті', modal_open:'відкриті налаштування'}},
  en: {prefix:'Blink', ready:'ready', reasons:{camera_paused:'camera paused', face_lost:'face not visible', eye_reference:'eye reference check', eyes_unreliable:'eye signal unreliable', head_motion:'head moving', eye_posture:'eye posture', closed:'eyes closed', modal_open:'settings open'}},
  de: {prefix:'Blinzeln', ready:'bereit', reasons:{camera_paused:'Kamera pausiert', face_lost:'Gesicht nicht sichtbar', eye_reference:'Augenreferenzprüfung', eyes_unreliable:'Augensignal unzuverlässig', head_motion:'Kopf bewegt sich', eye_posture:'Augenhaltung', closed:'Augen geschlossen', modal_open:'Einstellungen offen'}},
  es: {prefix:'Parpadeo', ready:'listo', reasons:{camera_paused:'cámara en pausa', face_lost:'rostro no visible', eye_reference:'comprobación de referencia ocular', eyes_unreliable:'señal de ojos poco fiable', head_motion:'cabeza en movimiento', eye_posture:'postura de ojos', closed:'ojos cerrados', modal_open:'ajustes abiertos'}},
  pt: {prefix:'Piscadela', ready:'pronta', reasons:{camera_paused:'câmara em pausa', face_lost:'rosto não visível', eye_reference:'verificação de referência dos olhos', eyes_unreliable:'sinal dos olhos pouco fiável', head_motion:'cabeça em movimento', eye_posture:'postura dos olhos', closed:'olhos fechados', modal_open:'definições abertas'}},
  it: {prefix:'Battito', ready:'pronto', reasons:{camera_paused:'fotocamera in pausa', face_lost:'viso non visibile', eye_reference:'verifica riferimento occhi', eyes_unreliable:'segnale degli occhi non affidabile', head_motion:'testa in movimento', eye_posture:'postura degli occhi', closed:'occhi chiusi', modal_open:'impostazioni aperte'}}
};
const MODE_TEXT = {
  ru: {
    mouth: {ready:'Губы: поцелуй — нажатие, открытый рот — удаление.',acquiring:'Держите лицо спокойно, губы расслаблены.',calibrating:'Смотрите на клавиатуру. Держите голову и лицо спокойно.',counters:{clicks:'Нажатия',deletes:'Удаления',rejected:'Отклонено'}},
    blink: {ready:'Моргание: моргните для нажатия выделенной клавиши.',acquiring:'Держите глаза обычно открытыми.',calibrating:'Смотрите на клавиатуру. Держите голову спокойно, глаза обычно открытыми.'},
    external: {ready:'Внешняя кнопка: нажмите назначенную клавишу. Камера может двигать выделение головой.',acquiring:'Нажмите назначенную внешнюю кнопку или используйте голову для выбора.',calibrating:'Смотрите на клавиатуру. Держите голову спокойно; внешняя кнопка работает отдельно.'}
  },
  uk: {
    mouth: {ready:'Губи: поцілунок — натискання, широко відкритий рот — видалення.',acquiring:'Тримайте обличчя спокійно, губи розслаблені.',calibrating:'Дивіться на клавіатуру. Тримайте голову й обличчя спокійно.',counters:{clicks:'Натискання',deletes:'Видалення',rejected:'Відхилено'}},
    blink: {ready:'Моргання: моргніть для натискання виділеної клавіші.',acquiring:'Тримайте очі звично відкритими.',calibrating:'Дивіться на клавіатуру. Тримайте голову спокійно, очі звично відкритими.'},
    external: {ready:'Зовнішня кнопка: натисніть призначену клавішу. Камера може рухати виділення головою.',acquiring:'Натисніть призначену зовнішню кнопку або використовуйте голову для вибору.',calibrating:'Дивіться на клавіатуру. Тримайте голову спокійно; зовнішня кнопка працює окремо.'}
  },
  en: {
    mouth: {ready:'Lips: pucker to press, open your mouth wide to delete.',acquiring:'Keep your face calm and lips relaxed.',calibrating:'Look at the keyboard. Keep your head and face still.',counters:{clicks:'Clicks',deletes:'Deletes',rejected:'Rejected'}},
    blink: {ready:'Blink: blink to press the selected key.',acquiring:'Keep your eyes normally open.',calibrating:'Look at the keyboard. Keep your head still and eyes normally open.'},
    external: {ready:'External button: press the assigned key. The camera can still move the selection with your head.',acquiring:'Press the assigned external button or use your head to select.',calibrating:'Look at the keyboard. Keep your head still; the external button works separately.'}
  },
  de: {
    mouth: {ready:'Lippen: Lippen spitzen — drücken, Mund weit öffnen — löschen.',acquiring:'Halten Sie das Gesicht ruhig und die Lippen entspannt.',calibrating:'Blicken Sie auf die Tastatur. Halten Sie Kopf und Gesicht ruhig.',counters:{clicks:'Drücken',deletes:'Löschen',rejected:'Abgelehnt'}},
    blink: {ready:'Blinzeln: blinzeln Sie, um die markierte Taste zu drücken.',acquiring:'Halten Sie die Augen normal offen.',calibrating:'Blicken Sie auf die Tastatur. Halten Sie den Kopf ruhig und die Augen normal offen.'},
    external: {ready:'Externe Taste: Drücken Sie die zugewiesene Taste. Die Kamera kann die Auswahl weiterhin per Kopfbewegung steuern.',acquiring:'Drücken Sie die zugewiesene externe Taste oder wählen Sie mit dem Kopf.',calibrating:'Blicken Sie auf die Tastatur. Halten Sie den Kopf ruhig; die externe Taste funktioniert separat.'}
  },
  es: {
    mouth: {ready:'Labios: frunza los labios para pulsar; abra mucho la boca para borrar.',acquiring:'Mantenga el rostro tranquilo y los labios relajados.',calibrating:'Mire el teclado. Mantenga la cabeza y el rostro quietos.',counters:{clicks:'Pulsaciones',deletes:'Borrados',rejected:'Rechazado'}},
    blink: {ready:'Parpadeo: parpadee para pulsar la tecla seleccionada.',acquiring:'Mantenga los ojos normalmente abiertos.',calibrating:'Mire el teclado. Mantenga la cabeza quieta y los ojos normalmente abiertos.'},
    external: {ready:'Botón externo: pulse la tecla asignada. La cámara aún puede mover la selección con la cabeza.',acquiring:'Pulse el botón externo asignado o use la cabeza para seleccionar.',calibrating:'Mire el teclado. Mantenga la cabeza quieta; el botón externo funciona por separado.'}
  },
  pt: {
    mouth: {ready:'Lábios: franza os lábios para premir; abra bem a boca para apagar.',acquiring:'Mantenha o rosto calmo e os lábios relaxados.',calibrating:'Olhe para o teclado. Mantenha a cabeça e o rosto imóveis.',counters:{clicks:'Pressões',deletes:'Apagamentos',rejected:'Rejeitado'}},
    blink: {ready:'Piscadela: pisque para premir a tecla selecionada.',acquiring:'Mantenha os olhos normalmente abertos.',calibrating:'Olhe para o teclado. Mantenha a cabeça imóvel e os olhos normalmente abertos.'},
    external: {ready:'Botão externo: prima a tecla associada. A câmara ainda pode mover a seleção com a cabeça.',acquiring:'Prima o botão externo associado ou use a cabeça para selecionar.',calibrating:'Olhe para o teclado. Mantenha a cabeça imóvel; o botão externo funciona separadamente.'}
  },
  it: {
    mouth: {ready:'Labbra: stringi le labbra per premere; apri bene la bocca per cancellare.',acquiring:'Mantieni il viso calmo e le labbra rilassate.',calibrating:'Guarda la tastiera. Mantieni testa e viso fermi.',counters:{clicks:'Pressioni',deletes:'Cancellazioni',rejected:'Rifiutato'}},
    blink: {ready:'Battito: batti le palpebre per premere il tasto selezionato.',acquiring:'Mantieni gli occhi normalmente aperti.',calibrating:'Guarda la tastiera. Mantieni la testa ferma e gli occhi normalmente aperti.'},
    external: {ready:'Pulsante esterno: premi il tasto assegnato. La fotocamera può ancora muovere la selezione con la testa.',acquiring:'Premi il pulsante esterno assegnato o usa la testa per selezionare.',calibrating:'Guarda la tastiera. Mantieni la testa ferma; il pulsante esterno funziona separatamente.'}
  }
};

const MOUTH_FEEDBACK = {
  ru:{release:'Верните губы в обычное положение, чтобы завершить жест.',unreliable:'Убедитесь, что рот виден камере.',retry:'Действие не принято — повторите жест.'},
  uk:{release:'Поверніть губи у звичайне положення, щоб завершити жест.',unreliable:'Переконайтеся, що рот видно камері.',retry:'Дію не прийнято — повторіть жест.'},
  en:{release:'Relax your lips to finish the gesture.',unreliable:'Make sure your mouth is visible to the camera.',retry:'Action not accepted. Repeat the gesture.'},
  de:{release:'Entspannen Sie die Lippen, um die Geste abzuschließen.',unreliable:'Achten Sie darauf, dass die Kamera Ihren Mund sehen kann.',retry:'Aktion nicht übernommen. Wiederholen Sie die Geste.'},
  es:{release:'Relaje los labios para terminar el gesto.',unreliable:'Asegúrese de que la cámara pueda ver su boca.',retry:'Acción no aceptada. Repita el gesto.'},
  pt:{release:'Relaxe os lábios para terminar o gesto.',unreliable:'Certifique-se de que a câmara consegue ver a sua boca.',retry:'Ação não aceite. Repita o gesto.'},
  it:{release:'Rilassi le labbra per completare il gesto.',unreliable:'Si assicuri che la bocca sia visibile alla fotocamera.',retry:'Azione non accettata. Ripeta il gesto.'}
};

const EYE_TEXT = {
  ru:['Глаза открыты','Глаза закрыты','Закрыт один глаз','Ожидание глаз','Морганий','Вводов','Не принято','условия ввода не выполнены','буква ещё не готова','слишком короткое','слишком долгое','лицо не видно','буква изменилась','открыты настройки','пауза между морганиями','ошибка ввода','движение головы','низкая уверенность','закрыт только один глаз'],
  uk:['Очі відкриті','Очі закриті','Закрите одне око','Очікування очей','Моргань','Введень','Не прийнято','умови введення не виконані','літера ще не готова','надто коротке','надто довге','обличчя не видно','літера змінилася','відкриті налаштування','пауза між морганнями','помилка введення','рух голови','низька впевненість','закрите лише одне око'],
  en:['Eyes open','Eyes closed','One eye closed','Waiting for eyes','Blinks','Typed','Rejected','input conditions not met','letter not ready yet','too short','too long','face not visible','letter changed','settings open','blink cooldown','input failed','head moving','low confidence','only one eye closed'],
  de:['Augen offen','Augen geschlossen','Ein Auge geschlossen','Warte auf Augen','Blinzler','Eingaben','Abgelehnt','Eingabebedingungen nicht erfüllt','Buchstabe noch nicht bereit','zu kurz','zu lang','Gesicht nicht sichtbar','Buchstabe geändert','Einstellungen offen','Pause zwischen Blinzlern','Eingabe fehlgeschlagen','Kopf bewegt sich','geringe Sicherheit','nur ein Auge geschlossen'],
  es:['Ojos abiertos','Ojos cerrados','Un ojo cerrado','Esperando ojos','Parpadeos','Entradas','Rechazado','condiciones de entrada no cumplidas','letra aún no lista','demasiado corto','demasiado largo','rostro no visible','letra cambiada','ajustes abiertos','pausa entre parpadeos','falló la entrada','cabeza en movimiento','baja confianza','solo un ojo cerrado'],
  pt:['Olhos abertos','Olhos fechados','Um olho fechado','A aguardar olhos','Piscadelas','Entradas','Rejeitado','condições de entrada não cumpridas','letra ainda não pronta','demasiado curto','demasiado longo','rosto não visível','letra alterada','definições abertas','pausa entre piscadelas','falha na entrada','cabeça em movimento','baixa confiança','apenas um olho fechado'],
  it:['Occhi aperti','Occhi chiusi','Un occhio chiuso','In attesa degli occhi','Battiti','Inserimenti','Rifiutato','condizioni di inserimento non soddisfatte','lettera non ancora pronta','troppo breve','troppo lungo','viso non visibile','lettera cambiata','impostazioni aperte','pausa tra battiti','inserimento non riuscito','testa in movimento','bassa affidabilità','un solo occhio chiuso']
};

export function createTrackingPanel(app) {
  const toolbar = document.createElement('section');
  toolbar.className = 'tracking-toolbar';
  const buttons = ['trackingStart','trackingStop','trackingCalibrate'].map(id => {
    const button = document.createElement('button');
    button.id = id; button.type = 'button'; button.dataset.actionId = id;
    toolbar.append(button);
    return button;
  });
  const status = document.createElement('p');
  status.id = 'trackingStatus'; status.setAttribute('role','status');
  status.setAttribute('aria-live','polite'); toolbar.append(status);
  const navigationIndicator = document.createElement('div');
  navigationIndicator.id = 'trackingNavigation';
  navigationIndicator.className = 'tracking-navigation';
  navigationIndicator.hidden = true;
  const navigationPhase = document.createElement('span');
  navigationPhase.className = 'tracking-navigation-phase';
  const navigationTimer = document.createElement('span');
  navigationTimer.className = 'tracking-navigation-timer';
  navigationTimer.setAttribute('aria-hidden','true');
  const navigationAnnounce = document.createElement('span');
  navigationAnnounce.className = 'tracking-sr-only';
  navigationAnnounce.setAttribute('role','status');
  navigationAnnounce.setAttribute('aria-live','polite');
  navigationAnnounce.setAttribute('aria-atomic','true');
  navigationIndicator.append(navigationPhase, navigationTimer, navigationAnnounce);
  toolbar.append(navigationIndicator);
  const blinkIndicator = document.createElement('div');
  blinkIndicator.id = 'trackingBlinkAvailability';
  blinkIndicator.className = 'tracking-blink-availability';
  blinkIndicator.hidden = true;
  toolbar.append(blinkIndicator);
  const video = document.createElement('video');
  video.muted = true; video.playsInline = true; video.hidden = true;
  document.querySelector('#keyboardArea').before(toolbar);
  toolbar.append(video);
  const style = document.createElement('style');
  style.textContent = `
    .tracking-toolbar {display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px;padding:4px;background:var(--bg);}
    .tracking-toolbar button {min-width:0;min-height:44px;padding:5px 8px;border:1px solid var(--border);border-radius:8px;background:var(--control-bg);color:var(--text);font:600 clamp(14px,1.5vw,20px)/1.2 Arial,sans-serif;overflow-wrap:anywhere;}
    .tracking-toolbar button:disabled {opacity:.55;}
    .tracking-toolbar button:focus-visible,.tracking-toolbar button.selected {outline:3px solid #087dff;outline-offset:-3px;}
    .tracking-toolbar p {grid-column:1/-1;margin:0;min-height:5.2em;max-height:5.2em;overflow:auto;text-align:center;display:flex;align-items:center;justify-content:center;white-space:pre-line;font:500 16px/1.3 Arial,sans-serif;}
    .tracking-navigation {grid-column:1/-1;display:flex;flex-wrap:wrap;align-items:baseline;justify-content:center;gap:4px 10px;min-height:1.4em;text-align:center;font:700 14px/1.3 Arial,sans-serif;}
    .tracking-navigation[data-locked='true'] {color:#8a4b00;}
    .tracking-navigation-timer {font-variant-numeric:tabular-nums;white-space:nowrap;}
    .tracking-blink-availability {grid-column:1/-1;text-align:center;font:600 13px/1.3 Arial,sans-serif;color:#3a3a3c;overflow-wrap:anywhere;}
    .tracking-blink-availability[data-ready='false'] {color:#8a4b00;}
    .tracking-return-locked {outline:3px solid #b36b00 !important;outline-offset:-3px;}
    .tracking-navigation[hidden], .tracking-blink-availability[hidden] {display:none;}
    .tracking-sr-only {position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0;}
    /* The compact status slot stays the same size while gestures change its
       text, so keyboard geometry cannot move underneath a captured action. */
    .tracking-toolbar p {height:52px;min-height:52px;max-height:52px;overflow:auto;text-align:left;display:block;padding:2px 4px;font:500 13px/1.25 Arial,sans-serif;}
    .tracking-navigation {min-height:0;font-size:12px;}
    .tracking-blink-availability {font-size:12px;}
    @media (min-width: 900px) {
      .tracking-toolbar {grid-template-columns:repeat(3,minmax(0,max-content)) minmax(0,1fr);align-items:stretch;}
      .tracking-toolbar button {padding:4px 8px;}
      .tracking-toolbar p {grid-column:4;grid-row:1;display:flex;align-items:center;justify-content:flex-start;padding:2px 8px;}
      .tracking-navigation {grid-column:1/4;grid-row:2;justify-content:flex-start;flex-wrap:nowrap;max-height:18px;overflow:auto;}
      .tracking-blink-availability {grid-column:4;grid-row:2;text-align:left;white-space:nowrap;max-height:18px;overflow:auto;}
    }
    @media (max-width: 700px) {
      .tracking-toolbar p {text-align:center;display:flex;align-items:center;justify-content:center;}
    }
  `;
  document.head.append(style);
  let controller = null;
  let starting = false;
  let lastPaint = -Infinity;
  let errorCode = null;
  let serial = 0;
  let lockedKey = null;
  let lastNavAnnounce = '';
  const id = () => 'tracking-' + Date.now().toString(36) + '-' + (++serial);
  const engine = new TrackingEngine({
    onFrame(frame) {
      if (controller) {
        const current = app.getState();
        controller.ingest(frame, current);
      }
      paint();
    },
    onStatus(value) {
      if (!value.running && !starting && controller) controller.pause();
      paint(true);
    }
  });

  function snapshot() {
    return {
      engine:engine.getStatus(),
      controller:controller ? controller.getStatus() : {
        phase:'IDLE',
        fsm:{head:'NEUTRAL',blink:'REQUIRE_OPEN',armed:false},
        confidence:0,
        relativePose:{yaw:0,pitch:0,roll:0},
        lastError:null,
        navigation:{phase:'READY',locked:false,remainingMs:0,awaitingStablePose:false,recenters:0},
        blinkAvailability:{ready:false,reason:'camera_paused'}
      }
    };
  }

  function selectedKeyElement() {
    const selectedId = app.getState().selectedId;
    // Use the keyboard owner's existing action identity, also used for MCP actions.
    return [...document.querySelectorAll('[data-action-id]')]
      .find(element => element.dataset.actionId === selectedId) || null;
  }

  function setLockedKey(active) {
    if (!active) {
      if (lockedKey) lockedKey.classList.remove('tracking-return-locked');
      lockedKey = null;
      toolbar.classList.remove('tracking-nav-locked');
      return;
    }
    const next = selectedKeyElement();
    if (lockedKey && lockedKey !== next) lockedKey.classList.remove('tracking-return-locked');
    if (next) next.classList.add('tracking-return-locked');
    lockedKey = next;
    toolbar.classList.add('tracking-nav-locked');
  }

  function paint(force = false) {
    const now = performance.now();
    if (!force && now - lastPaint < 100) return;
    lastPaint = now;
    const appState = app.getState();
    const locale = appState.settings.uiLocale;
    const text = STRINGS[locale] || STRINGS.ru;
    const state = snapshot();
    const values = appState.inputSettings && appState.inputSettings.values ? appState.inputSettings.values : null;
    const source = state.controller.clickSource || (values && values.clickSource) || 'mouth';
    const modeText = MODE_TEXT[locale] || MODE_TEXT.ru;
    const sourceText = modeText[source] || modeText.mouth;
    const active = state.engine.running && !!controller;
    const navState = active && state.controller.navigation ? state.controller.navigation : null;
    const returning = !!navState && navState.phase === 'RETURNING';
    const navText = NAV_TEXT[locale] || NAV_TEXT.ru;
    navigationIndicator.hidden = !active;
    blinkIndicator.hidden = !active || source !== 'blink';
    if (active) {
      const remaining = returning ? Math.max(0, Number(navState.remainingMs) || 0) : 0;
      const phaseText = returning ? (remaining > 0 ? navText.locked : navText.hold) : navText.ready;
      if (navigationPhase.textContent !== phaseText) navigationPhase.textContent = phaseText;
      const timerText = returning && remaining > 0 ? navText.remaining.replace('{seconds}', (Math.ceil(remaining / 100) / 10).toFixed(1)) : '';
      if (navigationTimer.textContent !== timerText) navigationTimer.textContent = timerText;
      navigationIndicator.dataset.locked = returning ? 'true' : 'false';
      const announce = returning ? (remaining > 0 ? navText.locked : navText.hold) : navText.ready;
      if (lastNavAnnounce !== announce) {
        navigationAnnounce.textContent = announce;
        lastNavAnnounce = announce;
      }
      if (source === 'blink') {
        const blinkState = state.controller.blinkAvailability || {ready:false, reason:'camera_paused'};
        const blinkText = BLINK_TEXT[locale] || BLINK_TEXT.ru;
        const reason = blinkState.ready ? null : (blinkState.reason || 'camera_paused');
        const reasons = blinkText.reasons || {};
        const blinkMessage = reason === null ? `${blinkText.prefix}: ${blinkText.ready}` : `${blinkText.prefix}: ${reasons[reason] || reasons.camera_paused || ''}`;
        if (blinkIndicator.textContent !== blinkMessage) blinkIndicator.textContent = blinkMessage;
        blinkIndicator.dataset.ready = reason === null ? 'true' : 'false';
      } else {
        if (blinkIndicator.textContent !== '') blinkIndicator.textContent = '';
        blinkIndicator.removeAttribute('data-ready');
      }
      setLockedKey(returning);
    } else {
      if (navigationPhase.textContent !== '') navigationPhase.textContent = '';
      if (navigationTimer.textContent !== '') navigationTimer.textContent = '';
      navigationIndicator.removeAttribute('data-locked');
      if (lastNavAnnounce !== '') { navigationAnnounce.textContent = ''; lastNavAnnounce = ''; }
      if (blinkIndicator.textContent !== '') blinkIndicator.textContent = '';
      blinkIndicator.removeAttribute('data-ready');
      setLockedKey(false);
    }
    buttons.forEach((button,index) => {
      if (button.textContent !== text[index]) button.textContent = text[index];
      button.setAttribute('aria-label',text[index]);
    });
    toolbar.setAttribute('aria-label',text[0]);
    buttons[0].disabled = starting || state.engine.running;
    buttons[1].disabled = !starting && !state.engine.running;
    buttons[2].disabled = !state.engine.running || starting;
    const phase = state.controller.phase;
    let message = text[3];
    if (starting) message = text[4];
    else if (state.controller.lastError === 'EYE_SIGNAL_UNRELIABLE') message = EYE_UNRELIABLE[locale] || EYE_UNRELIABLE.ru;
    else if (state.controller.lastError) message = CONTROL_ERROR[locale] || CONTROL_ERROR.ru;
    else if (errorCode || state.engine.lastErrorCode) message = text[10];
    else if (state.engine.running) {
      if (phase === 'FACE_LOST') message = text[7];
      else if (phase === 'LOW_CONFIDENCE') message = text[8];
      else if (phase === 'EYE_SIGNAL_UNRELIABLE') message = EYE_UNRELIABLE[locale] || EYE_UNRELIABLE.ru;
      else if (phase === 'EYE_REFERENCE') message = EYE_REFERENCE[locale] || EYE_REFERENCE.ru;
      else if (phase === 'RETURN_CENTER') message = RETURN_CENTER[locale] || RETURN_CENTER.ru;
      else if (phase === 'CALIBRATING') message = sourceText.calibrating;
      else if (phase === 'CALIBRATION_REQUIRED' || phase === 'IDLE') message = text[13];
      else if (phase === 'PAUSED') message = text[12];
      else if (phase === 'REACQUIRE') message = sourceText.calibrating;
      else if (source === 'mouth' && state.controller.mouth) {
        const mouth = state.controller.mouth;
        const feedback = MOUTH_FEEDBACK[locale] || MOUTH_FEEDBACK.ru;
        message = mouth.ready ? sourceText.ready
          : mouth.reason === 'mouth_unreliable' ? feedback.unreliable
          : mouth.reason === 'gesture_active' || mouth.reason === 'rearm_required' ? feedback.release
          : sourceText.acquiring;
      }
      else message = state.controller.fsm.armed ? sourceText.ready : sourceText.acquiring;
    }
    if (source === 'blink' && (state.engine.running || state.controller.counts?.completedBlinks > 0)) {
      const labels = EYE_TEXT[locale] || EYE_TEXT.ru;
      const eyes = state.controller.eyes || {};
      const counts = state.controller.counts || {};
      const eyeIndex = {OPEN:0,CLOSED:1,ASYMMETRIC:2}[eyes.state] ?? 3;
      const eyeCaption = eyes.state === 'LOOKING_DOWN' ? (LOOKING_DOWN[locale] || LOOKING_DOWN.ru)
        : eyes.state === 'UNRELIABLE' ? (EYE_UNRELIABLE[locale] || EYE_UNRELIABLE.ru)
        : eyes.state === 'TRANSITION' ? (TRANSITION_EYES[locale] || TRANSITION_EYES.ru) : labels[eyeIndex];
      let detail = `${state.engine.running ? eyeCaption + ' · ' : ''}${labels[4]}: ${counts.completedBlinks || 0} · ${labels[5]}: ${counts.acceptedBlinks || 0}`;
      const last = state.controller.lastBlink;
      if (last && !last.accepted) {
        const index = REJECT_KEYS.indexOf(last.reason);
        const reason = last.reason === 'head_motion' ? (TURN_SIGNAL[locale] || TURN_SIGNAL.ru)
          : index < 0 ? labels[7] : labels[index + 8];
        detail += ` · ${labels[6]}: ${reason}`;
      }
      message += '\n' + detail;
    } else if (source === 'mouth' && state.controller.mouth) {
      const mouth = state.controller.mouth;
      const counts = mouth.counts || {};
      const labels = sourceText.counters || {};
      const clicks = Number.isFinite(counts.clicks) ? counts.clicks : 0;
      const deletes = Number.isFinite(counts.deletes) ? counts.deletes : 0;
      let detail = `${labels.clicks || ''}: ${clicks} · ${labels.deletes || ''}: ${deletes}`;
      if (Number.isFinite(counts.rejected) && counts.rejected > 0) {
        detail += ` · ${labels.rejected || ''}: ${counts.rejected}`;
      }
      const last = mouth.lastAction;
      if (last && last.accepted === false && last.reason) {
        detail += ` · ${(MOUTH_FEEDBACK[locale] || MOUTH_FEEDBACK.ru).retry}`;
      }
      message += '\n' + detail;
    }
    if (status.textContent !== message) {
      status.textContent = message;
      status.title = message;
    }
  }

  async function handle(name,args,context = {}) {
    if (name === 'tracking.getStatus') return snapshot();
    if (name === 'tracking.start') {
      // CRITICAL: this flag is derived by the owner from an actual trusted click.
      // JSON/MCP arguments can never grant permission to activate the camera.
      if (!context.userGesture) throw publicError('LOCAL_CAMERA_CONSENT');
      if (starting || engine.getStatus().running) return snapshot();
      starting = true; errorCode = null;
      controller = new HeadBlinkController({
        move:(direction,steps = 1) => app.dispatch('keyboard.move',{direction,steps,requestId:id()}),
        activate:snapshot => {
          const args = {
            requestId:id(),expectedId:snapshot.selectedId,geometryVersion:Number(snapshot.geometryVersion)
          };
          if (Number.isSafeInteger(snapshot.textRevision) && snapshot.textRevision >= 0) args.expectedTextRevision = snapshot.textRevision;
          return app.dispatch('keyboard.activate',args);
        },
        backspace:snapshot => {
          if (!Number.isSafeInteger(snapshot.textRevision) || snapshot.textRevision < 0) {
            return Promise.reject(publicError('STALE_TEXT'));
          }
          return app.dispatch('keyboard.backspace',{
            requestId:id(),expectedId:snapshot.selectedId,geometryVersion:Number(snapshot.geometryVersion),
            expectedTextRevision:snapshot.textRevision
          });
        },
        onStatus:() => paint()
      });
      controller.setClickSource(app.getState().inputSettings.values.clickSource);
      controller.configure(app.getState().trackingSettings.values);
      controller.beginCalibration();
      paint(true);
      try { await engine.start(video); }
      catch (error) {
        errorCode = 'CAMERA_OR_MODEL_ERROR'; controller.pause();
        throw publicError(errorCode);
      } finally { starting = false; paint(true); }
      return snapshot();
    }
    if (name === 'tracking.stop') {
      if (controller) controller.pause();
      await engine.stop(); starting = false; errorCode = null; paint(true);
      return snapshot();
    }
    if (name === 'tracking.calibrate') {
      if (!engine.getStatus().running || !controller) throw publicError('NOT_RUNNING');
      controller.resume(); controller.beginCalibration(); errorCode = null; paint(true);
      return snapshot();
    }
    throw publicError('INVALID_COMMAND');
  }

  ['tracking.start','tracking.stop','tracking.calibrate'].forEach((name,index) => {
    buttons[index].addEventListener('click',event => {
      // The toolbar already dispatches its semantic action. Do not route this
      // trusted click through keyboard activation a second time or move its key.
      event.stopPropagation();
      app.dispatch(name,{requestId:id()},event).catch(error => {
        errorCode = error.code === 'LOCAL_CAMERA_CONSENT' ? error.code : 'CAMERA_OR_MODEL_ERROR';
        paint(true);
      });
    });
  });
  window.addEventListener('keyboardlocalize',() => paint(true));
  initTuningPanel(app);
  paint(true);
  return {handle,getStatus:snapshot,configure(values) {
    if (controller) controller.configure(values);
    paint(true);
  },setClickSource(source) {
    if (controller) controller.setClickSource(source);
    paint(true);
  }};
}

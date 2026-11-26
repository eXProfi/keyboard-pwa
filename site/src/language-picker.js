/*
  Language picker: a button that opens a two-column list
  (English name | native name).

  Why not a native <select>: iPad Safari ignores min-height on a select and
  clips its text, and an <option> cannot show two aligned columns.

  The picker owns no settings state. app.js passes the current value in through
  setValue() and receives a choice through onSelect(), so the settings panel and
  the product MCP keep a single settings owner (app.dispatch).
*/

export function createLanguagePicker(options) {
  const trigger = options.trigger;
  const list = options.list;
  const items = options.items;
  const onSelect = options.onSelect;
  let value = null;
  let activeIndex = -1;

  function nameCells(item) {
    const english = document.createElement('span');
    english.className = 'language-english';
    english.textContent = item.english;
    const native = document.createElement('span');
    native.className = 'language-native';
    // lang picks the right CJK glyphs. Only the inner <bdi> is isolated, so
    // Arabic/Hebrew names read correctly while the cell keeps the interface
    // direction and stays aligned with the rest of the column.
    native.lang = item.id;
    const text = document.createElement('bdi');
    text.textContent = item.native;
    native.appendChild(text);
    return [english, native];
  }

  const rows = items.map(function (item, index) {
    const row = document.createElement('div');
    row.id = list.id + '-' + item.id;
    row.className = 'language-option';
    row.setAttribute('role', 'option');
    row.setAttribute('aria-selected', 'false');
    row.append(...nameCells(item));
    row.addEventListener('click', function () { choose(index); });
    list.appendChild(row);
    return row;
  });

  function isOpen() {
    return !list.hidden;
  }

  function setActive(index) {
    if (activeIndex >= 0) rows[activeIndex].classList.remove('active');
    activeIndex = Math.max(0, Math.min(rows.length - 1, index));
    const row = rows[activeIndex];
    row.classList.add('active');
    list.setAttribute('aria-activedescendant', row.id);
    // Scroll only the list, never the settings dialog behind it.
    if (row.offsetTop < list.scrollTop) {
      list.scrollTop = row.offsetTop;
    } else if (row.offsetTop + row.offsetHeight > list.scrollTop + list.clientHeight) {
      list.scrollTop = row.offsetTop + row.offsetHeight - list.clientHeight;
    }
  }

  function open() {
    if (isOpen()) return;
    list.hidden = false;
    trigger.setAttribute('aria-expanded', 'true');
    const selected = items.findIndex(function (item) { return item.id === value; });
    const row = rows[Math.max(0, selected)];
    list.scrollTop = row.offsetTop - (list.clientHeight - row.offsetHeight) / 2;
    setActive(Math.max(0, selected));
    // Bring the whole list into the scrollable settings panel when it fits.
    list.scrollIntoView({block:'nearest'});
    list.focus({preventScroll:true});
  }

  function close(focusTrigger) {
    if (!isOpen()) return;
    list.hidden = true;
    trigger.setAttribute('aria-expanded', 'false');
    list.removeAttribute('aria-activedescendant');
    if (focusTrigger) trigger.focus({preventScroll:true});
  }

  function choose(index) {
    const id = items[index].id;
    close(true);
    if (id === value) return;
    // Show the choice at once; app.js re-renders the stored value on failure.
    setValue(id);
    onSelect(id);
  }

  function setValue(id) {
    value = id;
    const item = items.find(function (entry) { return entry.id === id; });
    trigger.replaceChildren(...(item ? nameCells(item) : []));
    rows.forEach(function (row, index) {
      row.setAttribute('aria-selected', items[index].id === id ? 'true' : 'false');
    });
  }

  function jumpToLetter(key) {
    const letter = key.toLowerCase();
    for (let step = 1; step <= items.length; step += 1) {
      const index = (activeIndex + step) % items.length;
      if (items[index].english.toLowerCase().startsWith(letter)) {
        setActive(index);
        return;
      }
    }
  }

  trigger.addEventListener('click', function () {
    if (isOpen()) close(true);
    else open();
  });

  trigger.addEventListener('keydown', function (event) {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    // Handled here so the app's arrow-key navigation does not also move.
    event.preventDefault();
    open();
  });

  list.addEventListener('keydown', function (event) {
    const moves = {ArrowDown:1, ArrowUp:-1, PageDown:8, PageUp:-8};
    if (Object.hasOwn(moves, event.key)) {
      setActive(activeIndex + moves[event.key]);
    } else if (event.key === 'Home') {
      setActive(0);
    } else if (event.key === 'End') {
      setActive(rows.length - 1);
    } else if (event.key === 'Enter' || event.key === ' ') {
      choose(activeIndex);
    } else if (event.key === 'Escape') {
      // Closes only the list; the settings dialog stays open.
      close(true);
    } else if (event.key === 'Tab') {
      // Focus returns to the button first, then Tab moves on from it.
      close(true);
      return;
    } else if (event.key.length === 1 && /\p{L}/u.test(event.key)) {
      jumpToLetter(event.key);
    } else {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  // A tap or click anywhere outside the picker closes the list without choosing.
  document.addEventListener('pointerdown', function (event) {
    if (!isOpen()) return;
    if (trigger.contains(event.target) || list.contains(event.target)) return;
    close(false);
  }, true);

  return {setValue: setValue, close: close};
}

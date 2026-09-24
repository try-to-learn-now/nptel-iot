'use strict';

const CONFIG = {
  manifestPath: './data/manifest.json',
  maxQuestions: 200,
  historyLimit: 20,
  storage: {
    theme: 'nptel_iot_v8_theme',
    activeTest: 'nptel_iot_v8_active_test',
    history: 'nptel_iot_v8_history',
    lastResult: 'nptel_iot_v8_last_result'
  }
};

const state = {
  manifest: null,
  banks: [],
  questions: [],
  quarantined: [],
  loadFailures: [],
  activeTest: null,
  timerHandle: null,
  lastResult: null,
  history: []
};

const $ = (id) => document.getElementById(id);

const dom = {
  pageTitle: $('pageTitle'),
  themeBtn: $('themeBtn'),
  statUsable: $('statUsable'),
  statSets: $('statSets'),
  statImages: $('statImages'),
  statQuarantine: $('statQuarantine'),
  latestPyqBtn: $('latestPyqBtn'),
  quickMockBtn: $('quickMockBtn'),
  resumeBtn: $('resumeBtn'),
  resumeLabel: $('resumeLabel'),
  integrityBadge: $('integrityBadge'),
  integrityList: $('integrityList'),
  pyqCountBadge: $('pyqCountBadge'),
  pyqGrid: $('pyqGrid'),
  yearSelect: $('yearSelect'),
  sessionSelect: $('sessionSelect'),
  weekSelect: $('weekSelect'),
  typeSelect: $('typeSelect'),
  countSelect: $('countSelect'),
  timerSelect: $('timerSelect'),
  shuffleOptions: $('shuffleOptions'),
  practiceMode: $('practiceMode'),
  poolCount: $('poolCount'),
  poolImageCount: $('poolImageCount'),
  startMockBtn: $('startMockBtn'),
  testEmpty: $('testEmpty'),
  testShell: $('testShell'),
  testModeLabel: $('testModeLabel'),
  testTitle: $('testTitle'),
  testMeta: $('testMeta'),
  timerBox: $('timerBox'),
  timerText: $('timerText'),
  testProgress: $('testProgress'),
  answeredStat: $('answeredStat'),
  reviewStat: $('reviewStat'),
  unansweredStat: $('unansweredStat'),
  questionNo: $('questionNo'),
  questionSource: $('questionSource'),
  markBtn: $('markBtn'),
  questionBody: $('questionBody'),
  prevBtn: $('prevBtn'),
  clearBtn: $('clearBtn'),
  checkBtn: $('checkBtn'),
  nextBtn: $('nextBtn'),
  questionPalette: $('questionPalette'),
  paletteToggle: $('paletteToggle'),
  submitBtn: $('submitBtn'),
  saveCloseBtn: $('saveCloseBtn'),
  resultsEmpty: $('resultsEmpty'),
  resultsShell: $('resultsShell'),
  resultTitle: $('resultTitle'),
  resultScore: $('resultScore'),
  resultPercent: $('resultPercent'),
  resultCorrect: $('resultCorrect'),
  resultWrong: $('resultWrong'),
  resultUnanswered: $('resultUnanswered'),
  reviewList: $('reviewList'),
  historyList: $('historyList'),
  clearHistoryBtn: $('clearHistoryBtn')
};

init().catch((error) => {
  console.error(error);
  alert('The practice app could not initialize. Check data/manifest.json and browser console.');
});

async function init() {
  initTheme();
  bindStaticEvents();
  loadLocalState();
  await loadDataSafely();
  populateFilters();
  renderDashboard();
  renderPyqSets();
  renderHistory();
  renderLastResult();
  updateMockPool();
  restoreActiveTest(false);
  showPage('home');
}

function bindStaticEvents() {
  document.querySelectorAll('[data-go]').forEach((button) => {
    button.addEventListener('click', () => showPage(button.dataset.go));
  });
  dom.themeBtn.addEventListener('click', toggleTheme);
  dom.latestPyqBtn.addEventListener('click', startLatestPyq);
  dom.quickMockBtn.addEventListener('click', () => {
    setMockDefaults();
    startMock();
  });
  dom.resumeBtn.addEventListener('click', () => restoreActiveTest(true));
  [dom.yearSelect, dom.sessionSelect, dom.weekSelect, dom.typeSelect, dom.countSelect]
    .forEach((el) => el.addEventListener('change', onMockFilterChange));
  dom.startMockBtn.addEventListener('click', startMock);
  dom.prevBtn.addEventListener('click', () => moveQuestion(-1));
  dom.nextBtn.addEventListener('click', () => moveQuestion(1));
  dom.clearBtn.addEventListener('click', clearCurrentResponse);
  dom.markBtn.addEventListener('click', toggleCurrentReview);
  dom.checkBtn.addEventListener('click', checkCurrentSolution);
  dom.submitBtn.addEventListener('click', () => submitTest(false));
  dom.saveCloseBtn.addEventListener('click', saveAndClose);
  dom.paletteToggle.addEventListener('click', togglePalette);
  dom.clearHistoryBtn.addEventListener('click', clearHistory);

  document.addEventListener('keydown', (event) => {
    if (!state.activeTest || currentPage() !== 'test') return;
    if (event.key === 'ArrowLeft') moveQuestion(-1);
    if (event.key === 'ArrowRight') moveQuestion(1);
  });
}

function initTheme() {
  const saved = localStorage.getItem(CONFIG.storage.theme);
  const dark = saved === 'dark' || (!saved && window.matchMedia?.('(prefers-color-scheme: dark)').matches);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  updateThemeIcon();
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  localStorage.setItem(CONFIG.storage.theme, next);
  updateThemeIcon();
}

function updateThemeIcon() {
  dom.themeBtn.textContent = document.documentElement.dataset.theme === 'dark' ? '☀️' : '🌙';
}

function loadLocalState() {
  state.history = safeJsonParse(localStorage.getItem(CONFIG.storage.history), []);
  state.lastResult = safeJsonParse(localStorage.getItem(CONFIG.storage.lastResult), null);
}

async function loadDataSafely() {
  const manifestRes = await fetch(CONFIG.manifestPath, { cache: 'no-cache' });
  if (!manifestRes.ok) throw new Error('Could not load data/manifest.json');
  state.manifest = await manifestRes.json();

  const datasets = Array.isArray(state.manifest.datasets) ? state.manifest.datasets : [];
  const settled = await Promise.allSettled(
    datasets.map(async (entry) => {
      const expected = parseDatasetFile(entry.file);
      if (!expected.year || !expected.session) {
        throw new Error(`Cannot derive year/session from filename: ${entry.file}`);
      }

      const res = await fetch(`./data/${entry.file}`, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`${entry.file}: HTTP ${res.status}`);
      const bank = await res.json();
      return validateAndNormalizeBank(entry, bank, expected);
    })
  );

  state.banks = [];
  state.quarantined = [];
  state.loadFailures = [];

  settled.forEach((result, index) => {
    const file = datasets[index]?.file || `dataset-${index + 1}`;
    if (result.status === 'rejected') {
      state.loadFailures.push({ file, reason: result.reason?.message || String(result.reason) });
      return;
    }
    if (result.value.valid) state.banks.push(result.value.bank);
    else state.quarantined.push(result.value.issue);
  });

  const seen = new Set();
  state.questions = state.banks.flatMap((bank) => bank.questions).filter((q) => {
    if (seen.has(q.runtimeId)) return false;
    seen.add(q.runtimeId);
    return true;
  });
}

function validateAndNormalizeBank(manifestEntry, rawBank, expected) {
  const topYear = Number(rawBank.year);
  const topSession = normalizeSession(rawBank.session);
  const reasons = [];

  if (topYear && topYear !== expected.year) reasons.push(`bank year ${topYear} ≠ filename year ${expected.year}`);
  if (topSession && topSession !== expected.session) reasons.push(`bank session ${topSession} ≠ filename session ${expected.session}`);

  const rawQuestions = Array.isArray(rawBank.questions) ? rawBank.questions : [];
  if (!rawQuestions.length) reasons.push('no questions found');

  let metadataMismatch = 0;
  for (const q of rawQuestions) {
    const qYear = Number(q.year);
    const qSession = normalizeSession(q.session);
    if ((qYear && qYear !== expected.year) || (qSession && qSession !== expected.session)) metadataMismatch += 1;
  }

  const mismatchRatio = rawQuestions.length ? metadataMismatch / rawQuestions.length : 1;
  if (mismatchRatio > 0.1) reasons.push(`${metadataMismatch}/${rawQuestions.length} questions have year/session mismatch`);

  if (reasons.length) {
    return {
      valid: false,
      issue: { file: manifestEntry.file, expected, reasons }
    };
  }

  const questions = rawQuestions.map((q, index) => normalizeQuestion(q, manifestEntry.file, expected, index));
  return {
    valid: true,
    bank: {
      file: manifestEntry.file,
      year: expected.year,
      session: expected.session,
      title: `NPTEL IoT ${expected.year} ${expected.session}`,
      questions
    }
  };
}

function normalizeQuestion(q, file, expected, index) {
  const options = Array.isArray(q.options)
    ? q.options
        .filter((o) => o && o.key != null)
        .map((o) => ({ key: String(o.key), text: String(o.text ?? '') }))
    : [];

  const answerKeys = Array.isArray(q.answer?.keys)
    ? q.answer.keys.map(String)
    : q.answer?.key != null
      ? [String(q.answer.key)]
      : [];

  const imageRequired = Boolean(
    q.image_required === true ||
    q.needs_image === true ||
    String(q.type || '').toLowerCase() === 'image_based' ||
    String(q.response_mode || '').toLowerCase().includes('visual')
  );

  const week = Number(q.week) || inferNumber(q.week_label) || 0;
  const qNum = Number(q.qNum) || inferNumber(q.display_no?.split('-').pop()) || index + 1;
  const type = String(q.variety_tag || q.type || 'mcq').toLowerCase();
  const isMulti = answerKeys.length > 1 || String(q.response_mode || '').toLowerCase() === 'multi_select';

  return {
    runtimeId: `${file}::${q.id || q.uid || index}`,
    sourceId: String(q.id || q.uid || `${expected.year}-${expected.session}-${week}-${qNum}`),
    file,
    year: expected.year,
    session: expected.session,
    week,
    qNum,
    displayNo: String(q.display_no || `W${pad2(week)}-Q${pad2(qNum)}`),
    sourceLabel: String(q.source_label || `${expected.year} ${expected.session} | Week ${week} | Q${qNum}`),
    type,
    question: String(q.question || ''),
    codeBlock: q.code_block ? String(q.code_block) : '',
    options,
    answerKeys,
    answerDisplay: String(q.answer_display || (Array.isArray(q.answer?.text) ? q.answer.text.join(', ') : '')),
    solution: String(q.detailed_solution || ''),
    reference: String(q.reference || ''),
    marks: Number(q.marks) > 0 ? Number(q.marks) : 1,
    removed: Boolean(q.removed),
    imageRequired,
    isMulti,
    usable: !q.removed && !imageRequired && Boolean(q.question) && options.length >= 2 && answerKeys.length >= 1
  };
}

function parseDatasetFile(file) {
  const match = String(file || '').match(/(20\d{2})[_-](JAN|JULY)/i);
  return match ? { year: Number(match[1]), session: match[2].toUpperCase() } : { year: null, session: null };
}

function renderDashboard() {
  const usable = state.questions.filter((q) => q.usable).length;
  const images = state.questions.filter((q) => !q.removed && q.imageRequired).length;
  dom.statUsable.textContent = String(usable);
  dom.statSets.textContent = String(state.banks.length);
  dom.statImages.textContent = String(images);
  dom.statQuarantine.textContent = String(state.quarantined.length + state.loadFailures.length);

  const issues = [
    ...state.quarantined.map((x) => ({ ...x, kind: 'quarantine' })),
    ...state.loadFailures.map((x) => ({ ...x, kind: 'load' }))
  ];

  dom.integrityBadge.textContent = issues.length ? `${issues.length} blocked` : 'All valid';
  dom.integrityList.innerHTML = issues.length
    ? issues.map((item) => `
      <div class="integrity-row bad">
        <div><strong>${escapeHtml(item.file)}</strong><br><small>${escapeHtml((item.reasons || [item.reason]).join(' · '))}</small></div>
        <span class="badge">Excluded</span>
      </div>`).join('')
    : `<div class="integrity-row good"><div><strong>No dataset mismatch detected.</strong><br><small>Only validated banks can enter tests.</small></div><span class="badge">OK</span></div>`;

  updateResumeButton();
}

function renderPyqSets() {
  const banks = [...state.banks].sort(sortBankDesc);
  dom.pyqCountBadge.textContent = `${banks.length} sets`;
  dom.pyqGrid.innerHTML = banks.map((bank) => {
    const usable = bank.questions.filter((q) => q.usable);
    const weeks = [...new Set(usable.map((q) => q.week).filter(Boolean))].sort((a, b) => a - b);
    const imageCount = bank.questions.filter((q) => !q.removed && q.imageRequired).length;
    return `
      <article class="dataset-card">
        <h3>${escapeHtml(bank.year)} ${escapeHtml(bank.session)}</h3>
        <div class="dataset-meta">
          <span class="badge">${usable.length} usable</span>
          <span class="badge">${weeks.length} weeks</span>
          ${imageCount ? `<span class="badge">${imageCount} images skipped</span>` : ''}
        </div>
        <div class="dataset-actions">
          <button class="btn primary compact" data-pyq-file="${escapeAttr(bank.file)}" data-pyq-week="ALL" type="button">Full PYQ</button>
          <button class="btn secondary compact" data-pyq-practice="${escapeAttr(bank.file)}" type="button">Practice</button>
        </div>
        <div class="week-row">
          ${weeks.map((week) => `<button class="week-btn" data-pyq-file="${escapeAttr(bank.file)}" data-pyq-week="${week}" type="button">W${week}</button>`).join('')}
        </div>
      </article>`;
  }).join('');

  dom.pyqGrid.querySelectorAll('[data-pyq-file]').forEach((button) => {
    button.addEventListener('click', () => startPyq(button.dataset.pyqFile, button.dataset.pyqWeek, false));
  });
  dom.pyqGrid.querySelectorAll('[data-pyq-practice]').forEach((button) => {
    button.addEventListener('click', () => startPyq(button.dataset.pyqPractice, 'ALL', true));
  });
}

function populateFilters() {
  fillSelect(dom.yearSelect, uniqueSorted(state.banks.map((b) => b.year), (a, b) => b - a), 'All years');
  populateSessionOptions();
  populateWeekOptions();
  fillSelect(dom.typeSelect, uniqueSorted(state.questions.filter((q) => q.usable).map((q) => q.type)), 'All types', formatType);
}

function onMockFilterChange(event) {
  if (event.target === dom.yearSelect) {
    populateSessionOptions();
    populateWeekOptions();
  } else if (event.target === dom.sessionSelect) {
    populateWeekOptions();
  }
  updateMockPool();
}

function populateSessionOptions() {
  const year = dom.yearSelect.value;
  const sessions = uniqueSorted(
    state.banks.filter((b) => year === 'ALL' || String(b.year) === year).map((b) => b.session),
    (a, b) => sessionRank(b) - sessionRank(a)
  );
  fillSelect(dom.sessionSelect, sessions, 'All sessions');
}

function populateWeekOptions() {
  const year = dom.yearSelect.value;
  const session = dom.sessionSelect.value;
  const weeks = uniqueSorted(
    state.questions
      .filter((q) => q.usable)
      .filter((q) => year === 'ALL' || String(q.year) === year)
      .filter((q) => session === 'ALL' || q.session === session)
      .map((q) => q.week)
      .filter(Boolean),
    (a, b) => a - b
  );
  fillSelect(dom.weekSelect, weeks, 'All weeks', (x) => `Week ${x}`);
}

function fillSelect(select, values, allLabel, formatter = String) {
  const old = select.value;
  select.innerHTML = `<option value="ALL">${escapeHtml(allLabel)}</option>` +
    values.map((v) => `<option value="${escapeAttr(v)}">${escapeHtml(formatter(v))}</option>`).join('');
  if ([...select.options].some((o) => o.value === old)) select.value = old;
}

function updateMockPool() {
  const pool = getMockPool();
  const filteredRaw = state.questions.filter((q) => matchesBasicFilters(q));
  const skippedImages = filteredRaw.filter((q) => q.imageRequired && !q.removed).length;
  dom.poolCount.textContent = String(pool.length);
  dom.poolImageCount.textContent = String(skippedImages);
  dom.startMockBtn.disabled = pool.length === 0;
}

function matchesBasicFilters(q) {
  if (dom.yearSelect.value !== 'ALL' && String(q.year) !== dom.yearSelect.value) return false;
  if (dom.sessionSelect.value !== 'ALL' && q.session !== dom.sessionSelect.value) return false;
  if (dom.weekSelect.value !== 'ALL' && String(q.week) !== dom.weekSelect.value) return false;
  if (dom.typeSelect.value !== 'ALL' && q.type !== dom.typeSelect.value) return false;
  return true;
}

function getMockPool() {
  return state.questions.filter((q) => q.usable && matchesBasicFilters(q));
}

function setMockDefaults() {
  dom.yearSelect.value = 'ALL';
  populateSessionOptions();
  dom.sessionSelect.value = 'ALL';
  populateWeekOptions();
  dom.weekSelect.value = 'ALL';
  dom.typeSelect.value = 'ALL';
  dom.countSelect.value = '30';
  dom.timerSelect.value = '60';
  dom.shuffleOptions.checked = false;
  dom.practiceMode.checked = false;
  updateMockPool();
}

function startLatestPyq() {
  const latest = [...state.banks].sort(sortBankDesc)[0];
  if (!latest) return alert('No valid PYQ set is available.');
  startPyq(latest.file, 'ALL', false);
}

function startPyq(file, weekValue = 'ALL', practiceMode = false) {
  const bank = state.banks.find((b) => b.file === file);
  if (!bank) return alert('This dataset is unavailable or quarantined.');

  const week = weekValue === 'ALL' ? null : Number(weekValue);
  const pool = bank.questions
    .filter((q) => q.usable)
    .filter((q) => !week || q.week === week)
    .sort((a, b) => (a.week - b.week) || (a.qNum - b.qNum));

  if (!pool.length) return alert('No usable non-image questions are available in this selection.');

  createTest({
    mode: practiceMode ? 'practice' : 'pyq',
    title: `${bank.year} ${bank.session}${week ? ` · Week ${week}` : ' · Full PYQ'}`,
    questions: pool,
    timerMinutes: 0,
    shuffleOptions: false,
    allowSolutionCheck: practiceMode,
    sourceDescription: `${pool.length} questions · original PYQ order`
  });
}

function startMock() {
  const pool = getMockPool();
  if (!pool.length) return alert('No usable questions match the filters.');

  const requested = Number(dom.countSelect.value) || 30;
  const count = Math.min(requested, CONFIG.maxQuestions, pool.length);
  const selected = balancedSample(pool, count);

  createTest({
    mode: dom.practiceMode.checked ? 'practice' : 'mock',
    title: buildMockTitle(count),
    questions: selected,
    timerMinutes: Number(dom.timerSelect.value) || 0,
    shuffleOptions: dom.shuffleOptions.checked,
    allowSolutionCheck: dom.practiceMode.checked,
    sourceDescription: `${count} questions · balanced mixed selection`
  });
}

function createTest({ mode, title, questions, timerMinutes, shuffleOptions, allowSolutionCheck, sourceDescription }) {
  if (state.activeTest && !state.activeTest.submitted) {
    const replace = confirm('A saved test already exists. Replace it with this new test?');
    if (!replace) return;
  }

  const prepared = questions.map((q) => ({
    ...q,
    options: shuffleOptions ? shuffleArray([...q.options]) : [...q.options]
  }));

  state.activeTest = {
    version: 2,
    mode,
    title,
    sourceDescription,
    startedAt: Date.now(),
    timerMinutes,
    questions: prepared,
    currentIndex: 0,
    answers: {},
    marked: {},
    visited: { [prepared[0].runtimeId]: true },
    solutionChecked: {},
    submitted: false
  };
  persistActiveTest();
  renderTest();
  startTimerLoop();
  showPage('test');
}

function balancedSample(pool, count) {
  const groups = new Map();
  for (const q of pool) {
    const key = `${q.file}::W${q.week || 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(q);
  }

  const buckets = [...groups.values()].map((items) => shuffleArray([...items]));
  shuffleArray(buckets);
  const result = [];
  let cursor = 0;

  while (result.length < count && buckets.some((b) => b.length)) {
    const bucket = buckets[cursor % buckets.length];
    if (bucket.length) result.push(bucket.pop());
    cursor += 1;
  }
  return result;
}

function buildMockTitle(count) {
  const parts = [];
  if (dom.yearSelect.value !== 'ALL') parts.push(dom.yearSelect.value);
  if (dom.sessionSelect.value !== 'ALL') parts.push(dom.sessionSelect.value);
  if (dom.weekSelect.value !== 'ALL') parts.push(`Week ${dom.weekSelect.value}`);
  if (dom.typeSelect.value !== 'ALL') parts.push(formatType(dom.typeSelect.value));
  return `${parts.length ? parts.join(' · ') : 'Mixed Mock'} · ${count} Questions`;
}

function restoreActiveTest(navigate = true) {
  const saved = safeJsonParse(localStorage.getItem(CONFIG.storage.activeTest), null);
  if (!saved?.questions?.length || saved.submitted) {
    if (navigate) alert('No saved active test found.');
    updateResumeButton();
    return false;
  }
  state.activeTest = saved;
  renderTest();
  startTimerLoop();
  updateResumeButton();
  if (navigate) showPage('test');
  return true;
}

function persistActiveTest() {
  if (!state.activeTest) return;
  try {
    localStorage.setItem(CONFIG.storage.activeTest, JSON.stringify(state.activeTest));
  } catch (error) {
    console.error('Could not persist active test', error);
  }
  updateResumeButton();
}

function updateResumeButton() {
  const saved = safeJsonParse(localStorage.getItem(CONFIG.storage.activeTest), null);
  const available = Boolean(saved?.questions?.length && !saved.submitted);
  dom.resumeBtn.disabled = !available;
  dom.resumeLabel.textContent = available ? `${saved.title || 'Saved test'} · Q${Number(saved.currentIndex || 0) + 1}` : 'No saved test';
}

function renderTest() {
  const test = state.activeTest;
  if (!test?.questions?.length) {
    dom.testEmpty.classList.remove('hidden');
    dom.testShell.classList.add('hidden');
    return;
  }
  dom.testEmpty.classList.add('hidden');
  dom.testShell.classList.remove('hidden');

  const index = clamp(test.currentIndex, 0, test.questions.length - 1);
  test.currentIndex = index;
  const q = test.questions[index];
  test.visited[q.runtimeId] = true;

  dom.testModeLabel.textContent = test.mode === 'pyq' ? 'PYQ exam mode' : test.mode === 'practice' ? 'Practice mode' : 'Mixed mock';
  dom.testTitle.textContent = test.title;
  dom.testMeta.textContent = test.sourceDescription || '';
  dom.questionNo.textContent = `Question ${index + 1} of ${test.questions.length}`;
  dom.questionSource.textContent = q.sourceLabel;
  dom.prevBtn.disabled = index === 0;
  dom.nextBtn.textContent = index === test.questions.length - 1 ? 'Save response' : 'Save & Next →';
  dom.markBtn.textContent = test.marked[q.runtimeId] ? '★ Marked for review' : '☆ Mark for review';
  dom.checkBtn.classList.toggle('hidden', !test.allowSolutionCheck);

  renderQuestion(q);
  renderPalette();
  renderExamStats();
  renderTimer();
  persistActiveTest();
}

function renderQuestion(q) {
  const selected = normalizeSelected(state.activeTest.answers[q.runtimeId]);
  const checked = Boolean(state.activeTest.solutionChecked[q.runtimeId]);
  const optionHtml = q.options.map((option) => {
    const chosen = selected.includes(option.key);
    const isCorrectKey = q.answerKeys.includes(option.key);
    let statusClass = chosen ? 'selected' : '';
    if (checked) {
      if (isCorrectKey) statusClass += ' correct';
      else if (chosen) statusClass += ' wrong';
    }
    return `
      <button class="option ${statusClass.trim()}" type="button" data-option="${escapeAttr(option.key)}">
        <span class="option-key">${escapeHtml(option.key)}</span>
        <span>${escapeHtml(option.text)}</span>
      </button>`;
  }).join('');

  const instruction = q.isMulti ? '<div class="muted">Select all correct options.</div>' : '';
  const solution = checked ? `
    <div class="solution-box">
      <div class="answer">Correct answer: ${escapeHtml(q.answerDisplay || q.answerKeys.join(', '))}</div>
      ${q.solution ? `<div>${escapeHtml(q.solution)}</div>` : ''}
      ${q.reference ? `<div class="muted">Reference: ${escapeHtml(q.reference)}</div>` : ''}
    </div>` : '';

  dom.questionBody.innerHTML = `
    <div class="question-text">${escapeHtml(q.question)}</div>
    ${q.codeBlock ? `<pre class="code-block"><code>${escapeHtml(q.codeBlock)}</code></pre>` : ''}
    ${instruction}
    <div class="options">${optionHtml}</div>
    ${solution}`;

  dom.questionBody.querySelectorAll('[data-option]').forEach((button) => {
    button.addEventListener('click', () => selectOption(q, button.dataset.option));
  });
}

function selectOption(q, key) {
  const test = state.activeTest;
  if (!test) return;
  let selected = normalizeSelected(test.answers[q.runtimeId]);

  if (q.isMulti) {
    selected = selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key];
  } else {
    selected = [key];
  }

  if (selected.length) test.answers[q.runtimeId] = selected;
  else delete test.answers[q.runtimeId];
  delete test.solutionChecked[q.runtimeId];
  persistActiveTest();
  renderTest();
}

function clearCurrentResponse() {
  const q = currentQuestion();
  if (!q) return;
  delete state.activeTest.answers[q.runtimeId];
  delete state.activeTest.solutionChecked[q.runtimeId];
  persistActiveTest();
  renderTest();
}

function toggleCurrentReview() {
  const q = currentQuestion();
  if (!q) return;
  if (state.activeTest.marked[q.runtimeId]) delete state.activeTest.marked[q.runtimeId];
  else state.activeTest.marked[q.runtimeId] = true;
  persistActiveTest();
  renderTest();
}

function checkCurrentSolution() {
  const q = currentQuestion();
  if (!q) return;
  if (!normalizeSelected(state.activeTest.answers[q.runtimeId]).length) {
    alert('Select an answer first.');
    return;
  }
  state.activeTest.solutionChecked[q.runtimeId] = true;
  persistActiveTest();
  renderTest();
}

function moveQuestion(delta) {
  const test = state.activeTest;
  if (!test) return;
  const next = clamp(test.currentIndex + delta, 0, test.questions.length - 1);
  if (next === test.currentIndex) return;
  test.currentIndex = next;
  test.visited[test.questions[next].runtimeId] = true;
  persistActiveTest();
  renderTest();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderPalette() {
  const test = state.activeTest;
  dom.questionPalette.innerHTML = test.questions.map((q, index) => {
    const answered = normalizeSelected(test.answers[q.runtimeId]).length > 0;
    const review = Boolean(test.marked[q.runtimeId]);
    const current = index === test.currentIndex;
    const classes = [answered ? 'answered' : '', review ? 'review' : '', current ? 'current' : ''].filter(Boolean).join(' ');
    const label = review ? 'Marked for review' : answered ? 'Answered' : test.visited[q.runtimeId] ? 'Not answered' : 'Not visited';
    return `<button class="palette-btn ${classes}" type="button" data-index="${index}" title="Question ${index + 1}: ${label}">${index + 1}</button>`;
  }).join('');

  dom.questionPalette.querySelectorAll('[data-index]').forEach((button) => {
    button.addEventListener('click', () => {
      state.activeTest.currentIndex = Number(button.dataset.index);
      renderTest();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

function renderExamStats() {
  const test = state.activeTest;
  const answered = test.questions.filter((q) => normalizeSelected(test.answers[q.runtimeId]).length > 0).length;
  const review = test.questions.filter((q) => Boolean(test.marked[q.runtimeId])).length;
  const unanswered = test.questions.length - answered;
  dom.answeredStat.textContent = String(answered);
  dom.reviewStat.textContent = String(review);
  dom.unansweredStat.textContent = String(unanswered);
  dom.testProgress.style.width = `${Math.round((answered / test.questions.length) * 100)}%`;
}

function startTimerLoop() {
  stopTimerLoop();
  renderTimer();
  if (!state.activeTest?.timerMinutes) return;
  state.timerHandle = window.setInterval(() => {
    if (!state.activeTest) return stopTimerLoop();
    const remaining = getRemainingSeconds(state.activeTest);
    renderTimer();
    if (remaining <= 0) {
      stopTimerLoop();
      submitTest(true);
    }
  }, 1000);
}

function stopTimerLoop() {
  if (state.timerHandle) window.clearInterval(state.timerHandle);
  state.timerHandle = null;
}

function getRemainingSeconds(test) {
  if (!test?.timerMinutes) return null;
  const elapsed = Math.floor((Date.now() - Number(test.startedAt)) / 1000);
  return Math.max(0, test.timerMinutes * 60 - elapsed);
}

function renderTimer() {
  const test = state.activeTest;
  if (!test?.timerMinutes) {
    dom.timerBox.classList.add('hidden');
    return;
  }
  dom.timerBox.classList.remove('hidden');
  const remaining = getRemainingSeconds(test);
  const min = Math.floor(remaining / 60);
  const sec = remaining % 60;
  dom.timerText.textContent = `${pad2(min)}:${pad2(sec)}`;
  dom.timerBox.classList.toggle('warning', remaining <= 300);
}

function submitTest(autoSubmitted) {
  const test = state.activeTest;
  if (!test) return;

  const unanswered = test.questions.filter((q) => !normalizeSelected(test.answers[q.runtimeId]).length).length;
  if (!autoSubmitted) {
    const msg = unanswered
      ? `${unanswered} question(s) are unanswered. Submit anyway?`
      : 'Submit this test now?';
    if (!confirm(msg)) return;
  }

  const review = test.questions.map((q) => {
    const selected = normalizeSelected(test.answers[q.runtimeId]);
    const correct = sameSet(selected, q.answerKeys);
    return {
      runtimeId: q.runtimeId,
      sourceId: q.sourceId,
      sourceLabel: q.sourceLabel,
      question: q.question,
      codeBlock: q.codeBlock,
      options: q.options,
      selected,
      correctKeys: q.answerKeys,
      correctAnswer: q.answerDisplay,
      solution: q.solution,
      reference: q.reference,
      marks: q.marks,
      correct,
      answered: selected.length > 0
    };
  });

  const score = review.reduce((sum, item) => sum + (item.correct ? item.marks : 0), 0);
  const total = review.reduce((sum, item) => sum + item.marks, 0);
  const correct = review.filter((x) => x.correct).length;
  const answered = review.filter((x) => x.answered).length;
  const wrong = review.filter((x) => x.answered && !x.correct).length;
  const result = {
    id: `attempt_${Date.now()}`,
    title: test.title,
    mode: test.mode,
    submittedAt: Date.now(),
    autoSubmitted: Boolean(autoSubmitted),
    score,
    total,
    percent: total ? Math.round((score / total) * 100) : 0,
    correct,
    wrong,
    unanswered: review.length - answered,
    questionCount: review.length,
    review
  };

  state.lastResult = result;
  state.history.unshift(compactHistoryRecord(result));
  state.history = state.history.slice(0, CONFIG.historyLimit);

  localStorage.setItem(CONFIG.storage.lastResult, JSON.stringify(result));
  localStorage.setItem(CONFIG.storage.history, JSON.stringify(state.history));
  localStorage.removeItem(CONFIG.storage.activeTest);
  stopTimerLoop();
  state.activeTest = null;
  updateResumeButton();
  renderLastResult();
  renderHistory();
  showPage('results');
}

function compactHistoryRecord(result) {
  return {
    id: result.id,
    title: result.title,
    mode: result.mode,
    submittedAt: result.submittedAt,
    score: result.score,
    total: result.total,
    percent: result.percent,
    correct: result.correct,
    wrong: result.wrong,
    unanswered: result.unanswered,
    questionCount: result.questionCount
  };
}

function saveAndClose() {
  if (!state.activeTest) return;
  persistActiveTest();
  showPage('home');
}

function renderLastResult() {
  const r = state.lastResult;
  if (!r) {
    dom.resultsEmpty.classList.remove('hidden');
    dom.resultsShell.classList.add('hidden');
    return;
  }

  dom.resultsEmpty.classList.add('hidden');
  dom.resultsShell.classList.remove('hidden');
  dom.resultTitle.textContent = r.title;
  dom.resultScore.textContent = `${r.score} / ${r.total}`;
  dom.resultPercent.textContent = `${r.percent}%`;
  dom.resultCorrect.textContent = String(r.correct);
  dom.resultWrong.textContent = String(r.wrong);
  dom.resultUnanswered.textContent = String(r.unanswered);
  dom.reviewList.innerHTML = (r.review || []).map((item, index) => {
    const statusClass = !item.answered ? 'unanswered' : item.correct ? 'good' : 'bad';
    const statusText = !item.answered ? 'Unanswered' : item.correct ? 'Correct' : 'Incorrect';
    const yourAnswer = item.selected?.length
      ? item.selected.map((key) => `${key.toUpperCase()}. ${resolveOptionText(item.options, key)}`).join(' | ')
      : 'Not answered';
    const correctAnswer = item.correctKeys?.map((key) => `${key.toUpperCase()}. ${resolveOptionText(item.options, key)}`).join(' | ') || item.correctAnswer || '—';
    const optionHtml = (item.options || []).map((option) => {
      const key = option.key;
      const chosen = (item.selected || []).includes(key);
      const isCorrectKey = (item.correctKeys || []).includes(key);
      let status = '';
      if (isCorrectKey) status = 'correct';
      if (chosen && !isCorrectKey) status = `${status} wrong`.trim();
      else if (chosen) status = `${status} selected`.trim();
      return `
        <div class="option review-option ${status}">
          <span class="option-key">${escapeHtml(key)}</span>
          <span>${escapeHtml(option.text)}</span>
        </div>`;
    }).join('');
    return `
      <article class="review-item ${statusClass}">
        <h4>Q${index + 1} · ${escapeHtml(item.sourceLabel || '')} · ${statusText}</h4>
        <div class="question-text review-question-text">${escapeHtml(item.question)}</div>
        ${item.codeBlock ? `<pre class="code-block"><code>${escapeHtml(item.codeBlock)}</code></pre>` : ''}
        <div class="options review-options">${optionHtml}</div>
        <div class="review-lines">
          <div><strong>Your answer:</strong> ${escapeHtml(yourAnswer)}</div>
          <div><strong>Correct answer:</strong> ${escapeHtml(correctAnswer)}</div>
        </div>
        ${item.solution ? `<div class="review-solution"><strong>Explanation:</strong> ${escapeHtml(item.solution)}</div>` : ''}
        ${item.reference ? `<div class="muted">Reference: ${escapeHtml(item.reference)}</div>` : ''}
      </article>`;
  }).join('');
}

function renderHistory() {
  if (!state.history.length) {
    dom.historyList.innerHTML = '<div class="muted">No completed attempts yet.</div>';
    return;
  }
  dom.historyList.innerHTML = state.history.map((item) => `
    <article class="history-item">
      <div>
        <h4>${escapeHtml(item.title)}</h4>
        <div class="muted">${escapeHtml(formatMode(item.mode))} · ${item.questionCount} questions · ${formatDate(item.submittedAt)}</div>
        <div class="muted">${item.correct} correct · ${item.wrong} wrong · ${item.unanswered} unanswered</div>
      </div>
      <div class="score">${item.percent}%</div>
    </article>`).join('');
}

function clearHistory() {
  if (!state.history.length) return;
  if (!confirm('Clear saved attempt history?')) return;
  state.history = [];
  localStorage.removeItem(CONFIG.storage.history);
  renderHistory();
  renderDashboard();
}

function togglePalette() {
  const collapsed = dom.questionPalette.classList.toggle('hidden');
  dom.paletteToggle.textContent = collapsed ? '⌃' : '⌄';
}

function showPage(page) {
  const valid = ['home', 'pyq', 'mock', 'test', 'results', 'history'];
  const target = valid.includes(page) ? page : 'home';
  document.querySelectorAll('.page').forEach((el) => el.classList.toggle('active', el.dataset.page === target));
  document.querySelectorAll('.nav-btn').forEach((el) => el.classList.toggle('active', el.dataset.go === target));
  const titleMap = { home: 'Dashboard', pyq: 'PYQ Sets', mock: 'Mock Builder', test: 'Test', results: 'Results', history: 'History' };
  dom.pageTitle.textContent = titleMap[target];
  if (target === 'test') renderTest();
  if (target === 'results') renderLastResult();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function currentPage() {
  return document.querySelector('.page.active')?.dataset.page || 'home';
}

function currentQuestion() {
  const test = state.activeTest;
  return test?.questions?.[test.currentIndex] || null;
}

function normalizeSelected(value) {
  if (Array.isArray(value)) return value.map(String);
  if (value == null || value === '') return [];
  return [String(value)];
}

function sameSet(a, b) {
  const aa = [...new Set(a.map(String))].sort();
  const bb = [...new Set(b.map(String))].sort();
  return aa.length === bb.length && aa.every((value, index) => value === bb[index]);
}

function resolveOptionText(options, key) {
  return options?.find((o) => String(o.key) === String(key))?.text || '';
}

function uniqueSorted(values, comparator) {
  const arr = [...new Set(values)];
  return comparator ? arr.sort(comparator) : arr.sort();
}

function sortBankDesc(a, b) {
  return (b.year - a.year) || (sessionRank(b.session) - sessionRank(a.session));
}

function sessionRank(session) {
  return normalizeSession(session) === 'JULY' ? 2 : normalizeSession(session) === 'JAN' ? 1 : 0;
}

function normalizeSession(value) {
  const s = String(value || '').toUpperCase();
  if (s === 'JAN' || s === 'JANUARY') return 'JAN';
  if (s === 'JULY' || s === 'JUL') return 'JULY';
  return s;
}

function inferNumber(value) {
  const match = String(value || '').match(/(\d+)/);
  return match ? Number(match[1]) : 0;
}

function formatType(value) {
  const map = {
    mcq: 'MCQ',
    true_false: 'True / False',
    fill_blank: 'Fill Blank',
    code_based: 'Code Based',
    single_select: 'Single Select',
    multi_select: 'Multi Select'
  };
  const raw = String(value || '');
  return map[raw] || raw.replaceAll('_', ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function formatMode(mode) {
  return mode === 'pyq' ? 'PYQ exam' : mode === 'practice' ? 'Practice' : 'Mixed mock';
}

function formatDate(timestamp) {
  try { return new Date(timestamp).toLocaleString(); }
  catch { return ''; }
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function safeJsonParse(text, fallback) {
  try { return text ? JSON.parse(text) : fallback; }
  catch { return fallback; }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, Number(value) || 0));
}

function pad2(value) {
  return String(Math.max(0, Number(value) || 0)).padStart(2, '0');
}

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function escapeAttr(value) {
  return escapeHtml(String(value ?? ''));
}

/**
 * MovieTeca — catálogo individual de filmes para Google Sheets + Apps Script.
 *
 * Estrutura criada automaticamente na aba "Filmes":
 * A: FILMES | B: NOTA | C: CHECK (0 = pendente; 1 = assistido) | D: GÊNERO
 *
 * Não utiliza IDs pessoais. Crie este projeto em Extensões > Apps Script
 * dentro de uma planilha Google Sheets nova (vinculado à planilha).
 *
 * O projeto é independente para cada pessoa que fizer a própria cópia.
 */
const CONFIG = Object.freeze({
  // Deixe vazio se o projeto Apps Script foi criado dentro da própria planilha.
  // Em um projeto independente (não vinculado), informe o ID da sua planilha.
  SPREADSHEET_ID: '',
  SHEET_NAME: 'Filmes',
  HEADERS: ['FILMES', 'NOTA', 'CHECK', 'GÊNERO'],
  START_ROW: 2,
  SELECTION_KEY: 'MOVIETECA_SELECTED_MOVIE',
  SPREADSHEET_KEY: 'MOVIETECA_SPREADSHEET_ID'
});

// Uma categoria principal por filme. A seleção é validada no servidor.
const GENRES = Object.freeze([
  'Ação',
  'Animação',
  'Aventura',
  'Biografia',
  'Comédia',
  'Crime',
  'Documentário',
  'Drama',
  'Esporte',
  'Família',
  'Fantasia',
  'Faroeste',
  'Ficção científica',
  'Guerra',
  'História',
  'Mistério',
  'Musical',
  'Romance',
  'Suspense',
  'Terror',
  'Outros'
]);

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('MovieTeca · Meu catálogo de filmes')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/** Pode ser executada manualmente no editor para configurar a primeira utilização. */
function setupCatalog() {
  // No editor de um projeto vinculado, o Google expõe a planilha ativa.
  // Salva seu ID em propriedades privadas, pois em um Web App o método
  // getActiveSpreadsheet() não fica disponível.
  const spreadsheet = CONFIG.SPREADSHEET_ID
    ? SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('Abra o editor por Extensões > Apps Script da sua planilha, ou configure SPREADSHEET_ID.');
  }
  PropertiesService.getScriptProperties().setProperty(CONFIG.SPREADSHEET_KEY, spreadsheet.getId());
  getSheet_();
  return getAppData();
}

/** Retorna os filmes, a escolha atual e o horário da consulta. */
function getAppData() {
  const movies = getMovies_(getSheet_());
  const saved = PropertiesService.getScriptProperties().getProperty(CONFIG.SELECTION_KEY);
  let selected = null;
  if (saved) {
    try {
      const ref = JSON.parse(saved);
      selected = movies.find(m => sameTitle_(m.title, ref.title) && !m.watched) || null;
    } catch (err) { /* Seleção antiga inválida é descartada. */ }
  }
  return { movies: movies, selected: selected, updatedAt: new Date().toISOString() };
}

/** Cadastra um filme pendente EM MAIÚSCULAS ao final do catálogo, preservando a ordem atual. */
function addMovie(title, genre) {
  const clean = cleanTitle_(title);
  const selectedGenre = validGenre_(genre);
  return withLock_(() => {
    const sheet = getSheet_();
    const movies = getMovies_(sheet);
    if (movies.some(m => sameTitle_(m.title, clean))) {
      throw new Error('Este filme já está no catálogo.');
    }
    const lastMovieRow = movies.length ? movies[movies.length - 1].row : 1;
    const newRow = Math.max(lastMovieRow + 1, CONFIG.START_ROW);
    ensureRows_(sheet, newRow);
    sheet.getRange(newRow, 1, 1, 4).setValues([[clean, '', 0, selectedGenre]]);
    SpreadsheetApp.flush();
    return getAppData();
  });
}

/** Guarda a escolha de um filme pendente para a próxima sessão. */
function chooseMovie(row, title) {
  return withLock_(() => {
    const movie = resolveMovie_(getMovies_(getSheet_()), row, title);
    if (movie.watched) throw new Error('Este filme já foi assistido.');
    saveSelection_(movie);
    return getAppData();
  });
}

/** Sorteia uniformemente um filme entre os títulos ainda não assistidos. */
function drawRandomMovie() {
  return withLock_(() => {
    const pending = getMovies_(getSheet_()).filter(m => !m.watched);
    if (!pending.length) throw new Error('Não há filmes pendentes para sortear.');
    const chosen = pending[Math.floor(Math.random() * pending.length)];
    saveSelection_(chosen);
    return getAppData();
  });
}

/** Limpa apenas a escolha do filme, sem alterar a planilha. */
function clearSelection() {
  return withLock_(() => {
    PropertiesService.getScriptProperties().deleteProperty(CONFIG.SELECTION_KEY);
    return getAppData();
  });
}

/**
 * Avalia um filme (0 a 10).
 * - Novo assistido: entra imediatamente antes do primeiro pendente da sequência.
 * - Assistido anterior: somente a nota é editada; a ordem não muda.
 * - Os cabeçalhos e as colunas fora de A:D nunca são reordenados.
 */
function saveReview(payload) {
  if (!payload || typeof payload !== 'object') throw new Error('Avaliação inválida.');
  const score = validScore_(payload.score);
  return withLock_(() => {
    const sheet = getSheet_();
    const movies = getMovies_(sheet);
    const movie = resolveMovie_(movies, payload.row, payload.title);
    if (movie.watched) {
      sheet.getRange(movie.row, 2, 1, 2).setValues([[score, 1]]);
    } else {
      moveNewlyWatched_(sheet, movies, movie, score);
    }
    const stored = PropertiesService.getScriptProperties().getProperty(CONFIG.SELECTION_KEY);
    if (stored) {
      try {
        if (sameTitle_(JSON.parse(stored).title, movie.title)) {
          PropertiesService.getScriptProperties().deleteProperty(CONFIG.SELECTION_KEY);
        }
      } catch (err) {
        PropertiesService.getScriptProperties().deleteProperty(CONFIG.SELECTION_KEY);
      }
    }
    SpreadsheetApp.flush();
    return getAppData();
  });
}

/* ========================= Funções internas ========================= */

function getSpreadsheet_() {
  const props = PropertiesService.getScriptProperties();
  let id = CONFIG.SPREADSHEET_ID || props.getProperty(CONFIG.SPREADSHEET_KEY);
  // O acesso ativo só é utilizado no editor, nunca como dependência no Web App.
  if (!id) {
    const bound = SpreadsheetApp.getActiveSpreadsheet();
    if (!bound) {
      throw new Error('Configuração pendente. Execute setupCatalog uma vez no editor do Apps Script.');
    }
    id = bound.getId();
    props.setProperty(CONFIG.SPREADSHEET_KEY, id);
  }
  try {
    return SpreadsheetApp.openById(id);
  } catch (err) {
    throw new Error('Não foi possível abrir sua planilha. Execute setupCatalog novamente e confirme as permissões.');
  }
}

/**
 * Usa a aba "Filmes". Se não existir, renomeia a única aba vazia ou cria
 * uma aba nova, sem apagar o conteúdo das demais abas existentes.
 */
function getSheet_() {
  const spreadsheet = getSpreadsheet_();
  let sheet = spreadsheet.getSheetByName(CONFIG.SHEET_NAME);
  if (!sheet) {
    const tabs = spreadsheet.getSheets();
    if (tabs.length === 1 && tabs[0].getLastRow() === 0) {
      sheet = tabs[0].setName(CONFIG.SHEET_NAME);
    } else {
      sheet = spreadsheet.insertSheet(CONFIG.SHEET_NAME);
    }
  }

  const headers = sheet.getRange(1, 1, 1, CONFIG.HEADERS.length).getValues()[0];
  const emptyHeader = headers.every(value => String(value || '').trim() === '');
  if (emptyHeader) {
    if (sheet.getLastRow() > 0) {
      throw new Error('A aba Filmes tem dados sem cabeçalhos. Faça backup e configure A1:D1 antes de continuar.');
    }
    const range = sheet.getRange(1, 1, 1, 4);
    range.setValues([CONFIG.HEADERS]);
    range.setFontWeight('bold').setBackground('#30254c').setFontColor('#ffffff');
    sheet.setFrozenRows(1);
    sheet.setColumnWidth(1, 340);
    sheet.setColumnWidth(2, 100);
    sheet.setColumnWidth(3, 110);
    sheet.setColumnWidth(4, 170);
    return sheet;
  }
  // Compatibilidade com instalações antigas: A:C permanecem intactas.
  CONFIG.HEADERS.slice(0, 3).forEach((expected, index) => {
    if (normalize_(headers[index]) !== normalize_(expected)) {
      throw new Error('Cabeçalho incompatível em ' + String.fromCharCode(65 + index) +
        '1. Esperado: ' + expected + '. Não alterei os seus dados.');
    }
  });
  if (String(headers[3] || '').trim() === '') {
    // Não sobrescreva uma coluna D já utilizada para outras informações.
    const dataRows = Math.max(0, sheet.getLastRow() - 1);
    if (dataRows > 0 && sheet.getRange(2, 4, dataRows, 1).getValues()
      .some(row => String(row[0] == null ? '' : row[0]).trim() !== '')) {
      throw new Error('A coluna D contém dados sem cabeçalho. Faça backup e libere D antes da migração para GÊNERO.');
    }
    sheet.getRange(1, 4).setValue('GÊNERO')
      .setFontWeight('bold').setBackground('#30254c').setFontColor('#ffffff');
    sheet.setColumnWidth(4, 170);
  } else if (normalize_(headers[3]) !== normalize_('GÊNERO')) {
    throw new Error('Cabeçalho incompatível em D1. Esperado: GÊNERO. Não alterei os seus dados.');
  }
  return sheet;
}

/** A linha 1 nunca participa da lista, mesmo se for retornada como filme. */
function getMovies_(sheet) {
  const last = sheet.getLastRow();
  if (last < CONFIG.START_ROW) return [];
  const data = sheet.getRange(CONFIG.START_ROW, 1, last - CONFIG.START_ROW + 1, 4).getValues();
  const movies = [];
  data.forEach((cells, offset) => {
    const title = typeof cells[0] === 'string' ? cells[0].trim() : '';
    if (!title || normalize_(title) === 'FILMES') return;
    const score = toScore_(cells[1]);
    movies.push({
      row: CONFIG.START_ROW + offset,
      title: title,
      score: score,
      watched: isChecked_(cells[2]),
      genre: String(cells[3] == null ? '' : cells[3]).trim()
    });
  });
  return movies;
}

/**
 * Insere o filme avaliado no início dos pendentes, deslocando apenas A:D.
 * Não insere linhas físicas; filtros e colunas adicionais ficam intactos.
 */
function moveNewlyWatched_(sheet, movies, chosen, score) {
  const firstPending = movies.find(m => !m.watched);
  if (!firstPending || chosen.row < firstPending.row) {
    throw new Error('Não foi possível localizar a posição correta. Atualize o catálogo.');
  }
  if (chosen.row === firstPending.row) {
    sheet.getRange(chosen.row, 2, 1, 2).setValues([[score, 1]]);
    return;
  }
  const start = firstPending.row;
  const numberOfRows = chosen.row - start + 1;
  const range = sheet.getRange(start, 1, numberOfRows, 4);
  const current = range.getValues();
  const original = current.pop();
  // A referência da seleção é validada antes; esta checagem protege alterações simultâneas.
  if (!sameTitle_(original[0], chosen.title)) {
    throw new Error('O filme mudou de posição. Atualize a página antes de avaliar.');
  }
  const evaluated = [chosen.title, score, 1, original[3]];
  current.unshift(evaluated);
  range.setValues(current);
}

function saveSelection_(movie) {
  PropertiesService.getScriptProperties().setProperty(CONFIG.SELECTION_KEY,
    JSON.stringify({ title: movie.title }));
}

function resolveMovie_(movies, row, title) {
  if (!String(title || '').trim()) throw new Error('Selecione um filme primeiro.');
  const exact = movies.find(m => m.row === Number(row) && sameTitle_(m.title, title));
  if (exact) return exact;
  const candidates = movies.filter(m => sameTitle_(m.title, title));
  if (candidates.length === 1) return candidates[0];
  throw new Error('Filme não encontrado ou duplicado. Atualize a página.');
}

function withLock_(action) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try { return action(); }
  finally { lock.releaseLock(); }
}

function ensureRows_(sheet, requiredRow) {
  const remaining = requiredRow - sheet.getMaxRows();
  if (remaining > 0) sheet.insertRowsAfter(sheet.getMaxRows(), remaining);
}

function validScore_(value) {
  if (value === null || value === undefined || String(value).trim() === '') {
    throw new Error('Informe uma nota entre 0 e 10.');
  }
  const score = Number(String(value).trim().replace(',', '.'));
  if (!Number.isFinite(score) || score < 0 || score > 10 ||
      Math.abs(score * 100 - Math.round(score * 100)) > 1e-7) {
    throw new Error('A nota deve estar entre 0 e 10, com até duas casas decimais.');
  }
  return score;
}

function toScore_(value) {
  if (value === null || value === undefined || value === '') return null;
  const score = Number(String(value).trim().replace(',', '.'));
  return Number.isFinite(score) && score >= 0 && score <= 10 ? score : null;
}

function isChecked_(value) {
  return value === true || value === 1 || /^(1|TRUE|VERDADEIRO|SIM)$/i.test(String(value).trim());
}

function validGenre_(value) {
  const requested = String(value == null ? '' : value).trim();
  const genre = GENRES.find(item => normalize_(item) === normalize_(requested));
  if (!genre) throw new Error('Selecione um gênero válido na lista.');
  return genre;
}

function cleanTitle_(value) {
  if (typeof value !== 'string') throw new Error('Informe o título do filme.');
  const title = value.replace(/\s+/g, ' ').trim();
  if (title.length < 1 || title.length > 160) {
    throw new Error('O título deve ter entre 1 e 160 caracteres.');
  }
  if (normalize_(title) === 'FILMES') throw new Error('Esse título é reservado para o cabeçalho.');
  if (/^[=+\-@]/.test(title)) throw new Error('O título não pode começar com =, +, - ou @.');
  // Toda nova inclusão é persistida em caixa alta na planilha.
  return title.toUpperCase();
}

function normalize_(value) {
  return String(value || '').normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim().toUpperCase();
}

function sameTitle_(a, b) { return normalize_(a) === normalize_(b); }

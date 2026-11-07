/* Testes do Code.gs sem bibliotecas externas. Execute: node tests/backend.test.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('node:assert/strict');

const code = fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8');

function setup({nonempty = false, existing = false} = {}) {
  function createTab(initialName) {
    const rows=Array.from({length:20},()=>Array(8).fill(''));
    let tabName=initialName;
    const sheet={
      rows,
      getName(){return tabName;},
      setName(n){tabName=n;return sheet;},
      getLastRow(){let last=0;rows.forEach((r,i)=>{if(r.some(x=>x!==''&&x!==null))last=i+1;});return last;},
      getMaxRows(){return rows.length;},
      insertRowsAfter(after,n){rows.splice(after,0,...Array.from({length:n},()=>Array(8).fill('')));},
      setFrozenRows(){return sheet;},
      setColumnWidth(){return sheet;},
      getRange(row,col,nr=1,nc=1){
        const range={
          getValues(){return Array.from({length:nr},(_,i)=>Array.from({length:nc},(_,j)=>rows[row-1+i]?.[col-1+j]??''));},
          setValues(data){assert.equal(data.length,nr);data.forEach((record,i)=>{assert.equal(record.length,nc);record.forEach((value,j)=>{rows[row-1+i][col-1+j]=value;});});return range;},
          setValue(value){assert.equal(nr,1);assert.equal(nc,1);rows[row-1][col-1]=value;return range;},
          setFontWeight(){return range;},setBackground(){return range;},setFontColor(){return range;}
        };
        return range;
      }
    };
    return sheet;
  }
  const first=createTab(existing?'Filmes':'Planilha1');
  const rows=first.rows;
  if(nonempty)rows[0][0]='DADOS DE OUTRO SISTEMA';
  if(existing)rows[0].splice(0,3,'FILMES','NOTA','CHECK');
  const tabs=[first];
  const spreadsheet={
    getId(){return 'FAKE_USER_SHEET_ID';},
    getSheetByName(n){return tabs.find(tab=>tab.getName()===n)||null;},
    getSheets(){return tabs;},
    insertSheet(n){const tab=createTab(n);tabs.push(tab);return tab;}
  };
  const props={};let lockDepth=0;
  let webMode=false;
  const ctx={
    SpreadsheetApp:{getActiveSpreadsheet(){return webMode?null:spreadsheet;},openById(id){assert.equal(id,'FAKE_USER_SHEET_ID');return spreadsheet;},flush(){}},
    PropertiesService:{getScriptProperties(){return {getProperty(k){return props[k]??null;},setProperty(k,v){props[k]=v;},deleteProperty(k){delete props[k];}};}},
    LockService:{getScriptLock(){return {waitLock(){assert.equal(lockDepth++,0,'concurrent lock');},releaseLock(){lockDepth--;}};}},
    HtmlService:{createHtmlOutputFromFile(){return {setTitle(){return this;},addMetaTag(){return this;}};}}
  };
  vm.createContext(ctx);
  new vm.Script(code).runInContext(ctx);
  return {rows, sheet:first, tabs, props, call:(expr)=>vm.runInContext(expr,ctx), getTab:()=>first.getName(),setWebMode(value){webMode=value;}};
}
function titles(data){return Array.from(data.movies,m=>m.title);}

// Abre um Google Sheets realmente vazio, cria a aba e o cabeçalho sem lançar um filme fictício.
{
  const t=setup();
  const first=t.call('setupCatalog()');
  assert.equal(t.getTab(),'Filmes');
  assert.deepEqual(t.rows[0].slice(0,4),['FILMES','NOTA','CHECK','GÊNERO']);
  assert.equal(first.movies.length,0);
  assert.equal(t.props.MOVIETECA_SPREADSHEET_ID,'FAKE_USER_SHEET_ID');
  t.setWebMode(true); // simula execução como Web App, sem getActiveSpreadsheet()
  assert.equal(t.call('getAppData()').movies.length,0);
  assert.equal(t.rows[1][0],'');

  t.call('addMovie("A Cidade de Vidro", "Ficção científica")');
  t.call('addMovie("Estação Aurora", "Drama")');
  t.call('addMovie("Horizonte Azul", "Aventura")');
  t.call('addMovie("Noites de Outono", "Suspense")');
  let d=t.call('getAppData()');
  assert.deepEqual(titles(d),['A CIDADE DE VIDRO','ESTAÇÃO AURORA','HORIZONTE AZUL','NOITES DE OUTONO']);
  assert.equal(d.movies.filter(m=>m.watched).length,0);
  assert.equal(t.rows[4][2],0);
  assert.equal(t.rows[4][3],'Suspense');
  assert.throws(()=>t.call('addMovie("ESTACAO AURORA", "Drama")'),/já está/);
  assert.throws(()=>t.call('addMovie("=SUM(1;1)", "Drama")'),/não pode começar/);
  assert.throws(()=>t.call('addMovie("Filme sem gênero", "")'),/gênero válido/);
  assert.throws(()=>t.call('addMovie("Filme inválido", "Inventado")'),/gênero válido/);

  t.call('chooseMovie(2,"A Cidade de Vidro")');
  assert.equal(t.call('getAppData()').selected.title,'A CIDADE DE VIDRO');
  t.call('saveReview({row:2,title:"A Cidade de Vidro",score:8.25})');
  d=t.call('getAppData()');
  assert.equal(d.movies[0].score,8.25);
  assert.equal(d.movies.filter(m=>m.watched).length,1);
  assert.equal(d.selected,null);

  // Avalia o último filme da lista: deve ir após o primeiro assistido.
  t.rows[2][4]='COLUNA EXTRA PRESERVAR';
  t.call('saveReview({row:5,title:"Noites de Outono",score:0})');
  d=t.call('getAppData()');
  assert.deepEqual(titles(d),['A CIDADE DE VIDRO','NOITES DE OUTONO','ESTAÇÃO AURORA','HORIZONTE AZUL']);
  assert.equal(d.movies[1].row,3);
  assert.equal(d.movies[1].score,0,'nota zero precisa ser válida');
  assert.equal(t.rows[2][4],'COLUNA EXTRA PRESERVAR');
  assert.equal(d.movies[1].genre,'Suspense','gênero deve acompanhar o filme reordenado');
  assert.equal(d.movies[2].genre,'Drama','outros gêneros devem ser preservados');

  // Avalia outro pendente e preserva as posições cronológicas anteriores.
  t.call('saveReview({row:5,title:"Horizonte Azul",score:9.5})');
  d=t.call('getAppData()');
  assert.deepEqual(titles(d),['A CIDADE DE VIDRO','NOITES DE OUTONO','HORIZONTE AZUL','ESTAÇÃO AURORA']);
  const previous=titles(d);
  t.call('saveReview({row:3,title:"Noites de Outono",score:7})');
  d=t.call('getAppData()');
  assert.deepEqual(titles(d),previous,'editar nota antiga não pode reordenar');
  assert.equal(d.movies[1].score,7);
  assert.equal(d.movies[1].genre,'Suspense','editar nota não muda o gênero');
  // Primeiro pendente torna-se último assistido, sem deslocar a lista.
  t.call('saveReview({row:5,title:"Estação Aurora",score:10})');
  assert.equal(t.call('getAppData()').movies.filter(m=>m.watched).length,4);
  assert.throws(()=>t.call('drawRandomMovie()'),/Não há filmes pendentes/);
  assert.equal(t.rows[0][0],'FILMES','cabeçalho não deve se mover');
}

// Quando uma aba contém dados de outro sistema, a aplicação não a destrói.
{
  const t=setup({nonempty:true});
  const fresh=t.call('setupCatalog()');
  assert.equal(t.tabs.length,2);
  assert.equal(t.tabs[1].getName(),'Filmes');
  assert.equal(fresh.movies.length,0);
  assert.deepEqual(t.tabs[1].rows[0].slice(0,4),['FILMES','NOTA','CHECK','GÊNERO']);
  assert.equal(t.rows[0][0],'DADOS DE OUTRO SISTEMA');
}

// Cabeçalho e dados existentes são lidos, mas o próprio cabeçalho não entra no total.
{
  const t=setup({existing:true});
  t.rows[1].splice(0,3,'Lembranças do Mar',9,1);
  t.rows[2].splice(0,3,'O Farol', '',0);
  const d=t.call('getAppData()');
  assert.equal(d.movies.length,2);
  assert.equal(d.movies.filter(m=>m.watched).length,1);
  assert.equal(d.movies[0].score,9);
  assert.equal(t.rows[0][3],'GÊNERO','migra aba legada A:C para A:D');
  assert.equal(d.movies[0].genre,'','filme antigo fica sem gênero');
}
// Nunca sobrescrever a coluna D quando ela já pertence a outro processo.
{
  const t=setup({existing:true});
  t.rows[1][0]='Filme legado';
  t.rows[1][3]='DADO NÃO RELACIONADO';
  assert.throws(()=>t.call('setupCatalog()'),/coluna D contém dados/);
  assert.equal(t.rows[0][3],'');
  assert.equal(t.rows[1][3],'DADO NÃO RELACIONADO');
}

// Conversão deve funcionar também em caracteres acentuados e sem depender da interface.
{
  const t=setup();
  t.call('setupCatalog()');
  t.call('addMovie("harry PoTTer", "fantasia")');
  t.call('addMovie("ação dos heróis", "Ação")');
  const d=t.call('getAppData()');
  assert.deepEqual(titles(d),['HARRY POTTER','AÇÃO DOS HERÓIS']);
  assert.equal(t.rows[1][0],'HARRY POTTER');
  assert.equal(t.rows[2][0],'AÇÃO DOS HERÓIS');
  assert.equal(t.rows[1][3],'Fantasia','gênero do catálogo canônico e validado');
  assert.equal(t.rows[2][3],'Ação');
  assert.throws(()=>t.call('addMovie("Harry Potter","Fantasia")'),/já está/);
}
console.log('OK — instalação/migração para coluna de gênero, cadastro, gênero obrigatório, filtro via UI, duplicatas, notas, cronologia com gênero, cabeçalho e colunas extras; títulos em caixa alta');

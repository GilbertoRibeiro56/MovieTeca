"""Smoke test da prévia offline com Playwright (opcional para colaboradores)."""
import asyncio
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(__file__).resolve().parents[1]

async def main():
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(headless=True, executable_path='/usr/bin/chromium', args=['--no-sandbox'])
        page = await browser.new_page(viewport={'width': 1440, 'height': 920})
        errors = []
        page.on('pageerror', lambda error: errors.append(str(error)))
        await page.set_content((ROOT / 'PREVIA_Offline.html').read_text(encoding='utf-8'), wait_until='load')
        await page.wait_for_function('document.querySelectorAll(".stat .value").length===4')
        assert (await page.locator('.stat .value').all_text_contents())[:3] == ['7','3','4']
        assert await page.locator('#demoBanner').is_visible()
        # Créditos bilíngues e link mailto com assunto/corpo completos.
        footer = page.locator('footer.site-footer')
        assert await footer.is_visible()
        assert 'Desenvolvido por' in await footer.inner_text()
        assert 'Powered by' in await footer.inner_text()
        contact = page.locator('#developerEmailLink')
        assert await contact.inner_text() == 'Gordeath'
        url = await contact.get_attribute('href')
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url)
        params = parse_qs(parsed.query)
        assert parsed.scheme == 'mailto'
        assert 'Desenvolvimento do App/Site de filmes' in params['subject'][0]
        assert 'Movie List App/Website Development' in params['subject'][0]
        assert 'Oi, gostaria de falar com você' in params['body'][0]
        assert 'Hi, I would like to talk to you' in params['body'][0]

        await page.screenshot(path=str(ROOT / 'docs' / 'dashboard.png'), full_page=True)

        await page.locator('[data-nav="catalog"]').click()
        assert await page.locator('.movie-row').count() == 7
        assert await page.locator('.genre-tag').count() == 7
        await page.locator('#genreFilter').select_option('Terror')
        assert await page.locator('.movie-row').count() == 1
        assert await page.locator('.movie-title').first.text_content() == 'A Ilha das Sombras'
        await page.locator('#genreFilter').select_option('all')
        await page.screenshot(path=str(ROOT / 'docs' / 'catalogo-generos.png'), full_page=True)
        await page.locator('#filter').select_option('watched')
        assert await page.locator('.movie-row').count() == 3
        await page.locator('#filter').select_option('pending')
        assert await page.locator('.movie-row').count() == 4
        await page.locator('#search').fill('estacao')
        assert await page.locator('.movie-row').count() == 1
        await page.locator('#search').fill('')
        await page.locator('#filter').select_option('all')
        await page.locator('#order').select_option('title')
        assert (await page.locator('.movie-title').all_text_contents())[0] == 'A Cidade de Vidro'

        await page.locator('[data-nav="night"]').click()
        await page.locator('#manualMovie').select_option('7')
        await page.locator('[data-action="choose-manual"]').click()
        assert await page.locator('.chosen h2').first.text_content() == 'Noites de Outono'
        await page.locator('#score').fill('0')
        await page.locator('#reviewForm button[type="submit"]').click()
        await page.wait_for_function('document.querySelectorAll(".stat .value")[1].textContent==="4"')
        assert (await page.locator('.stat .value').all_text_contents())[:3] == ['7','4','3']
        order=await page.evaluate('state.data.movies.map(m=>m.title)')
        assert order[:5] == ['A Cidade de Vidro','O Último Trem','Horizonte Azul','Noites de Outono','Estação Aurora']
        await page.locator('[data-nav="catalog"]').click()
        await page.locator('[data-action="edit"]').last.click()
        assert await page.locator('#reviewForm').count() == 1
        await page.locator('#score').fill('8.75')
        await page.locator('#reviewForm button[type="submit"]').click()
        await page.wait_for_function('document.querySelectorAll(".stat .value")[1].textContent==="4"')
        assert await page.evaluate('state.data.movies.map(m=>m.title)') == order

        # A prévia também permite iniciar um catálogo completamente vazio.
        await page.locator('[data-action="demo-empty"]').click()
        await page.screenshot(path=str(ROOT / 'docs' / 'iniciar-do-zero.png'), full_page=True)
        assert (await page.locator('.stat .value').all_text_contents())[:3] == ['0','0','0']
        await page.locator('[data-nav="night"]').click()
        assert await page.locator('[data-action="random"]').first.is_disabled()
        await page.locator('[data-nav="add"]').click()
        await page.locator('#newTitle').fill('harry PoTTer')
        assert await page.locator('#newTitle').input_value() == 'HARRY POTTER'
        await page.locator('#newGenre').select_option('Fantasia')
        assert await page.locator('#newGenre option').count() == 22  # placeholder + 21 opções
        await page.screenshot(path=str(ROOT / 'docs' / 'cadastro-genero.png'), full_page=True)
        await page.locator('#addForm button[type="submit"]').click()
        await page.wait_for_selector('text=HARRY POTTER')
        assert await page.evaluate('state.data.movies[0].title') == 'HARRY POTTER'
        assert await page.evaluate('state.data.movies[0].genre') == 'Fantasia'
        assert 'Fantasia' in await page.locator('.genre-tag').first.inner_text()
        await page.locator('[data-action="select"]').click()
        await page.locator('#score').fill('9.5')
        await page.locator('#reviewForm button[type="submit"]').click()
        await page.wait_for_function('document.querySelectorAll(".stat .value")[1].textContent==="1"')
        assert (await page.locator('.stat .value').all_text_contents())[:3] == ['1','1','0']
        assert await page.evaluate('state.data.movies[0].genre') == 'Fantasia'
        assert errors == [], errors

        # Teste visual em celular com dados de exemplo.
        mobile = await browser.new_page(viewport={'width': 390, 'height': 844}, device_scale_factor=1)
        mobile_errors=[]
        mobile.on('pageerror',lambda error:mobile_errors.append(str(error)))
        await mobile.set_content((ROOT / 'PREVIA_Offline.html').read_text(encoding='utf-8'),wait_until='load')
        await mobile.wait_for_function('document.querySelectorAll(".stat .value").length===4')
        assert (await mobile.locator('.stat .value').all_text_contents())[:3]==['7','3','4']
        assert await mobile.locator('footer.site-footer').is_visible()
        assert await mobile.locator('#developerEmailLink').count() == 1
        await mobile.screenshot(path=str(ROOT / 'docs' / 'celular.png'),full_page=True)
        assert not mobile_errors,mobile_errors
        await browser.close()
        print('OK — dashboard, filtro por gênero, catálogo com gênero, busca, cadastro em caixa alta, ordem cronológica, avaliação, edição, rodapé e celular')

asyncio.run(main())

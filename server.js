import express from 'express';
import cors from 'cors';
import axios from 'axios';
import * as cheerio from 'cheerio';
import puppeteer from 'puppeteer';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 5001;

app.use(cors());
app.use(express.json());

// Global cache to avoid hitting Yahoo Finance rate limits and make subsequent loads instant
const cache = new Map();
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes cache

function getCachedData(key) {
  if (cache.has(key)) {
    const { data, timestamp } = cache.get(key);
    if (Date.now() - timestamp < CACHE_TTL) {
      return data;
    }
    cache.delete(key);
  }
  return null;
}

function setCachedData(key, data) {
  cache.set(key, { data, timestamp: Date.now() });
}

// 1. Scraping search results from DuckDuckGo using Puppeteer to bypass bot detection
async function searchDuckDuckGoPuppeteer(query) {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox']
    });
    const page = await browser.newPage();
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query + ' top public companies market cap')}`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 15000 });
    
    const results = await page.evaluate(() => {
      const items = [];
      const elements = document.querySelectorAll('.result');
      elements.forEach((el, index) => {
        if (index >= 12) return;
        const titleEl = el.querySelector('.result__title');
        const snippetEl = el.querySelector('.result__snippet');
        if (titleEl && snippetEl) {
          items.push({
            title: titleEl.innerText.trim(),
            snippet: snippetEl.innerText.trim()
          });
        }
      });
      return items;
    });
    return results;
  } catch (error) {
    console.error('Puppeteer DuckDuckGo search failed:', error.message);
    return [];
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// 2. OpenRouter API integration (resolving corrected sector and tickers via Gemini 3.5 Flash)
async function resolveCompaniesWithAI(query, searchResults, openRouterKey) {
  const apiKey = openRouterKey || process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    throw new Error('API_KEY_MISSING');
  }

  const prompt = `
You are a top financial research AI. The user wants to find the top 10 largest publicly traded companies by market cap matching this search query/sector: "${query}".

Here are some web search results for this query:
${searchResults.map((r, i) => `${i+1}. Title: ${r.title}\nSnippet: ${r.snippet}\n`).join('\n')}

Based on the search results and your own extensive knowledge:
1. Identify the correct, official classification name of this sector/industry (e.g. if the user wrote "IT", the official name is "Information Technology" or "Technology Services"). Return this in a field named "correctedSector" (e.g. "Information Technology, India").
2. Identify the top 10 largest publicly traded companies in that sector.
3. Determine their standard Yahoo Finance stock tickers.
   - For US companies, return standard tickers (e.g. 'PANW', 'CRWD', 'AAPL').
   - For Indian companies, return tickers with the correct suffix: '.NS' (NSE) or '.BO' (BSE) (e.g. 'TATASTEEL.NS', 'RELIANCE.NS', 'TCS.NS').
   - For German companies, use '.DE' suffix (e.g. 'SAP.DE').
   - For UK companies, use '.L' suffix (e.g. 'BP.L').
   - For other international markets, use their standard Yahoo Finance suffix (e.g. '.AX' for Australia, '.TO' for Canada, '.T' for Japan).
4. Estimate their current approximate market capitalization in USD (e.g. 150000000000 for $150 Billion).
5. If there are fewer than 10 companies, list as many as possible (minimum 5). Do not exceed 10 companies.
6. Output your response as a strict JSON object matching this structure:
{
  "correctedSector": "Information Technology Services, India",
  "companies": [
    { "ticker": "TCS.NS", "marketCap": 155000000000 },
    { "ticker": "INFY.NS", "marketCap": 78000000000 }
  ]
}

Do not include any explanation or markdown code fences. Just return the JSON object.
`;

  try {
    const response = await axios.post('https://openrouter.ai/api/v1/chat/completions', {
      model: 'google/gemini-3.5-flash',
      messages: [
        { role: 'user', content: prompt }
      ],
      response_format: { type: 'json_object' }
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://github.com/google-deepmind/antigravity',
        'X-Title': 'Sector Trend Analyzer'
      },
      timeout: 25000
    });

    const content = response.data.choices?.[0]?.message?.content?.trim();
    if (!content) throw new Error('Empty response from OpenRouter');

    const parsed = JSON.parse(content);
    if (parsed && Array.isArray(parsed.companies)) {
      return {
        correctedSector: parsed.correctedSector || query,
        companies: parsed.companies.map(c => ({
          ticker: c.ticker.toUpperCase().trim(),
          marketCap: Number(c.marketCap) || 0
        }))
      };
    }
    throw new Error('Unexpected response format from OpenRouter');
  } catch (error) {
    console.error('OpenRouter API call failed:', error.message);
    throw error;
  }
}

// 3. Yahoo Finance Quotes & Chart Data Aggregator
// Fetches quotes first, but falls back seamlessly to chart metadata to extract name, price, change, currency, and exchange if quote endpoint returns 401 Unauthorized.
async function getQuotesAndCharts(companiesList, range = '3mo') {
  const tickers = companiesList.map(c => c.ticker);
  const quotesMap = new Map();

  // Try fetching quotes (might fail with 401 if Yahoo Finance requirescrumb/cookies)
  try {
    const url = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${tickers.map(encodeURIComponent).join(',')}`;
    const response = await axios.get(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
      },
      timeout: 6000
    });
    
    const results = response.data?.quoteResponse?.result || [];
    results.forEach(q => {
      quotesMap.set(q.symbol, {
        symbol: q.symbol,
        name: q.longName || q.shortName || q.symbol,
        marketCap: q.marketCap || 0,
        price: q.regularMarketPrice || 0,
        change: q.regularMarketChangePercent || 0,
        currency: q.currency || 'USD',
        exchange: q.fullExchangeName || q.exchange || ''
      });
    });
  } catch (error) {
    console.warn('Yahoo Finance Quote fetch failed. Falling back to chart metadata:', error.message);
  }

  // Fetch charts & enrich metadata
  const enrichedResults = await Promise.all(
    companiesList.map(async (companyObj) => {
      const ticker = companyObj.ticker;
      let quote = quotesMap.get(ticker);
      
      let chart = [];
      let meta = null;

      try {
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(ticker)}?range=${range}&interval=1d`;
        const response = await axios.get(url, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/115.0.0.0 Safari/537.36',
          },
          timeout: 10000
        });

        const result = response.data?.chart?.result?.[0];
        if (result) {
          meta = result.meta;
          const timestamps = result.timestamp || [];
          const closes = result.indicators?.quote?.[0]?.close || [];
          let lastValidClose = 0;

          for (let i = 0; i < timestamps.length; i++) {
            let close = closes[i];
            if (close === null || close === undefined) {
              close = lastValidClose;
            } else {
              lastValidClose = close;
            }
            const date = new Date(timestamps[i] * 1000).toISOString().split('T')[0];
            chart.push({ date, close: Number(close.toFixed(2)) });
          }

          // Backfill chart starts
          if (chart.length > 0 && chart[0].close === 0) {
            const firstValid = chart.find(d => d.close > 0)?.close || 0;
            chart.forEach(d => {
              if (d.close === 0) d.close = firstValid;
            });
          }
        }
      } catch (chartError) {
        console.error(`Yahoo Finance Chart fetch failed for ${ticker}:`, chartError.message);
      }

      // If quote fetch was blocked (e.g. 401) but chart succeeded, construct company info from chart metadata
      if (!quote && meta) {
        let changePercent = 0;
        if (chart.length >= 2) {
          const prev = chart[chart.length - 2].close;
          const last = chart[chart.length - 1].close;
          if (prev > 0) {
            changePercent = ((last - prev) / prev) * 100;
          }
        }

        quote = {
          symbol: ticker,
          name: meta.longName || meta.shortName || ticker.split('.')[0],
          marketCap: companyObj.marketCap || 0, // Use AI estimated cap
          price: meta.regularMarketPrice || (chart.length > 0 ? chart[chart.length - 1].close : 0),
          change: changePercent,
          currency: meta.currency || (ticker.endsWith('.NS') || ticker.endsWith('.BO') ? 'INR' : 'USD'),
          exchange: meta.fullExchangeName || meta.exchangeName || ''
        };
      } else if (!quote) {
        // Complete fallback
        quote = {
          symbol: ticker,
          name: ticker.split('.')[0],
          marketCap: companyObj.marketCap || 0,
          price: 0,
          change: 0,
          currency: ticker.endsWith('.NS') || ticker.endsWith('.BO') ? 'INR' : 'USD',
          exchange: ''
        };
      } else {
        // Quote succeeded, but check if market cap needs fallback
        if (quote.marketCap === 0) {
          quote.marketCap = companyObj.marketCap || 0;
        }
      }

      return {
        ...quote,
        chart
      };
    })
  );

  return enrichedResults;
}

// 4. Puppeteer Google Finance stock screenshot capture (immune to search query CAPTCHAs)
async function captureGoogleStockScreenshot(ticker, range = '3mo') {
  let browser;
  try {
    browser = await puppeteer.launch({
      headless: true,
      args: ['--no-sandbox', '--disable-setuid-sandbox', '--window-size=1200,900']
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 1200, height: 900 });
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');
    
    // Map Yahoo ticker to Google Finance symbol format
    let gfSymbol = ticker;
    if (ticker.endsWith('.NS')) {
      gfSymbol = `${ticker.slice(0, -3)}:NSE`;
    } else if (ticker.endsWith('.BO')) {
      gfSymbol = `${ticker.slice(0, -3)}:BOM`;
    } else if (ticker.endsWith('.DE')) {
      gfSymbol = `${ticker.slice(0, -3)}:FRA`;
    } else if (ticker.endsWith('.L')) {
      gfSymbol = `${ticker.slice(0, -2)}:LON`;
    } else {
      const parts = ticker.split('.');
      gfSymbol = parts[0];
    }

    // Map range to Google Finance window parameter
    let windowParam = '6M'; // Default best match for 3mo
    if (range === '1mo') {
      windowParam = '1M';
    } else if (range === '3mo') {
      windowParam = '6M';
    } else if (range === '6mo') {
      windowParam = '6M';
    } else if (range === '1y') {
      windowParam = '1Y';
    }

    const searchUrl = `https://www.google.com/finance/quote/${gfSymbol}?hl=en&window=${windowParam}`;
    await page.goto(searchUrl, { waitUntil: 'networkidle2', timeout: 15000 });
    
    // Wait for the chart to fully load/render (and any dynamic client scripts)
    await new Promise(resolve => setTimeout(resolve, 3500));
    
    // Take a screenshot of the main stock chart and quote area
    // Google Finance renders the stock header and chart in the top-left section of the page.
    const screenshotBase64 = await page.screenshot({
      encoding: 'base64',
      clip: { x: 120, y: 150, width: 750, height: 480 }
    });
    
    return screenshotBase64;
  } catch (error) {
    console.error(`Screenshot failed for ${ticker}:`, error.message);
    throw error;
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}



// 5. Get fallback companies catalog if API key is missing
function getFallbackCompanies(query) {
  const q = query.toLowerCase();
  if (q.includes('cybersecurity') && q.includes('us')) {
    return {
      correctedSector: "Cybersecurity, US",
      companies: [
        { ticker: "PANW", marketCap: 115e9 },
        { ticker: "CRWD", marketCap: 75e9 },
        { ticker: "FTNT", marketCap: 60e9 },
        { ticker: "NET", marketCap: 30e9 },
        { ticker: "ZS", marketCap: 25e9 },
        { ticker: "OKTA", marketCap: 12e9 },
        { ticker: "GEN", marketCap: 15e9 },
        { ticker: "S", marketCap: 8e9 },
        { ticker: "CYBR", marketCap: 11e9 },
        { ticker: "TENB", marketCap: 5e9 }
      ]
    };
  }
  if (q.includes('steel') && q.includes('india')) {
    return {
      correctedSector: "Steel, India",
      companies: [
        { ticker: "JSWSTEEL.NS", marketCap: 25e9 },
        { ticker: "TATASTEEL.NS", marketCap: 24e9 },
        { ticker: "SAIL.NS", marketCap: 6e9 },
        { ticker: "JSL.NS", marketCap: 7e9 },
        { ticker: "JINDALSTEL.NS", marketCap: 11e9 },
        { ticker: "NMDC.NS", marketCap: 8e9 },
        { ticker: "KALYANIFRG.NS", marketCap: 1.5e9 }
      ]
    };
  }
  return null;
}

// MAIN ANALYZE ENDPOINT
app.post('/api/analyze', async (req, res) => {
  const { query, range = '3mo', openRouterKey } = req.body;

  if (!query || query.trim() === '') {
    return res.status(400).json({ success: false, error: 'Query is required.' });
  }

  const cacheKey = `${query.toLowerCase().trim()}_${range}`;
  const cached = getCachedData(cacheKey);
  if (cached) {
    console.log(`Returning cached data for key: ${cacheKey}`);
    return res.json({ success: true, ...cached, cached: true });
  }

  let steps = [];
  const logStep = (message) => {
    console.log(`[ANALYSIS STEP] ${message}`);
    steps.push(message);
  };

  try {
    let companiesList = [];
    let correctedSector = query;
    const fallbackData = getFallbackCompanies(query);
    const apiKey = openRouterKey || process.env.OPENROUTER_API_KEY;

    if (!apiKey && fallbackData) {
      logStep('OpenRouter API Key not found. Using preloaded fallback company catalog.');
      companiesList = fallbackData.companies;
      correctedSector = fallbackData.correctedSector;
    } else if (!apiKey) {
      return res.status(401).json({
        success: false,
        error: 'OpenRouter API Key is missing. Please enter it in the settings panel to analyze arbitrary sectors.',
        needsKey: true
      });
    } else {
      // 1. Scraping search results
      logStep('Scraping search results from DuckDuckGo using Puppeteer...');
      let searchResults = await searchDuckDuckGoPuppeteer(query);
      
      if (!searchResults || searchResults.length === 0) {
        logStep('Search scraping failed. Checking local fallbacks...');
        if (fallbackData) {
          companiesList = fallbackData.companies;
          correctedSector = fallbackData.correctedSector;
        } else {
          throw new Error('Could not scrape search results and no fallback was found for this query.');
        }
      } else {
        // 2. Resolve tickers and corrected sector using Gemini 3.5 Flash
        logStep('Analyzing search results & resolving correct sector name with Gemini 3.5 Flash...');
        try {
          const aiResult = await resolveCompaniesWithAI(query, searchResults, apiKey);
          companiesList = aiResult.companies;
          correctedSector = aiResult.correctedSector;
          logStep(`AI resolved sector: "${correctedSector}" with tickers: ${companiesList.map(c => c.ticker).join(', ')}`);
        } catch (aiError) {
          logStep('AI classification failed. Checking local fallbacks...');
          if (fallbackData) {
            companiesList = fallbackData.companies;
            correctedSector = fallbackData.correctedSector;
          } else {
            throw aiError;
          }
        }
      }
    }

    // 3. Fetch Quotes & Chart data combined
    logStep('Fetching financial metrics and historical charts from Yahoo Finance...');
    let enrichedCompanies = await getQuotesAndCharts(companiesList, range);
    
    // Sort and filter top 10
    enrichedCompanies = enrichedCompanies
      .filter(c => c.price > 0 || (c.chart && c.chart.length > 0))
      .sort((a, b) => b.marketCap - a.marketCap)
      .slice(0, 10);

    if (enrichedCompanies.length === 0) {
      throw new Error('Yahoo Finance quote and chart lookup returned no active stocks. The tickers resolved might be invalid.');
    }

    const payload = {
      query,
      correctedSector,
      range,
      companies: enrichedCompanies,
      steps
    };

    setCachedData(cacheKey, payload);

    logStep('Analysis completed successfully.');
    res.json({ success: true, ...payload });

  } catch (error) {
    console.error('Error during analysis:', error);
    res.status(500).json({
      success: false,
      error: error.message || 'An error occurred during analysis.',
      steps
    });
  }
});

// SCREENSHOT ENDPOINT
app.post('/api/screenshot', async (req, res) => {
  const { ticker, range = '3mo' } = req.body;
  if (!ticker) {
    return res.status(400).json({ success: false, error: 'Ticker is required.' });
  }

  console.log(`[SCREENSHOT] Starting screenshot capture for: ${ticker} with timeframe: ${range}`);
  try {
    const screenshotBase64 = await captureGoogleStockScreenshot(ticker, range);
    res.json({
      success: true,
      ticker,
      range,
      screenshot: `data:image/png;base64,${screenshotBase64}`
    });
  } catch (error) {
    console.error(`[SCREENSHOT ERROR] Screenshot capture failed for ${ticker}:`, error);
    res.status(500).json({
      success: false,
      error: `Failed to capture screenshot for ${ticker}: ${error.message}`
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});

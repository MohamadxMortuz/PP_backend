const axios = require('axios');
const config = require('../config/config');
const { ApiError } = require('../middleware/errorHandler');
const Bottleneck = require('bottleneck');

class ScrapingService {
  constructor() {
    this.apiKey = config.scraperApi.apiKey;
    this.baseUrl = 'https://api.scraperapi.com/';

    // Rate limiter
    this.limiter = new Bottleneck({
      minTime: 2000,
      maxConcurrent: 1,
      reservoir: 100,
      reservoirRefreshAmount: 100,
      reservoirRefreshInterval: 60 * 60 * 1000
    });
  }

  async searchProducts(query, options = {}) {
    return this.limiter.schedule(() => this._searchProducts(query, options));
  }

  async _searchProducts(query, options = {}) {
    try {
      const { page = 1, sort = 'relevance', priceMin, priceMax } = options;

      // ✅ Combine filters properly (FIXED)
      const tbsParts = [];

      if (sort === 'price_low') tbsParts.push('p_ord:p');
      else if (sort === 'price_high') tbsParts.push('p_ord:pd');
      else if (sort === 'rating') tbsParts.push('p_ord:rv');

      if (priceMin || priceMax) {
        tbsParts.push('mr:1', 'price:1');
        if (priceMin) tbsParts.push(`ppr_min:${priceMin}`);
        if (priceMax) tbsParts.push(`ppr_max:${priceMax}`);
      }

      let googleShoppingUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&tbm=shop&hl=en&gl=in`;

      if (tbsParts.length) {
        googleShoppingUrl += `&tbs=${tbsParts.join(',')}`;
      }

      if (page > 1) {
        googleShoppingUrl += `&start=${(page - 1) * 10}`;
      }

      console.log(`Scraping URL: ${googleShoppingUrl}`);

      // ✅ Optimized fields
      const fields = [
        'title',
        'price',
        'price_lower',
        'link',
        'source',
        'thumbnail',
        'rating',
        'reviews_count'
      ].join(',');

      const scraperUrl = `${this.baseUrl}?api_key=${this.apiKey}&url=${encodeURIComponent(
        googleShoppingUrl
      )}&country_code=in&device_type=desktop&output_format=json&autoparse=true&fields=${fields}`;

      console.log(`ScraperAPI URL: ${scraperUrl}`);

      const response = await axios.get(scraperUrl, {
        timeout: 30000
      });

      if (response.status !== 200) {
        throw new ApiError('Failed to fetch product data', 502);
      }

      const data = response.data;

      const products = this.transformShoppingResults(data, query).slice(0, 12);

      const totalResults = this.extractTotalResults(data);

      return {
        products,
        pagination: {
          currentPage: page,
          totalPages: Math.ceil(totalResults / 10),
          totalResults
        }
      };
    } catch (error) {
      console.error('Error in searchProducts:', error.message);
      throw new ApiError(`Scraping failed: ${error.message}`, 500);
    }
  }

  transformShoppingResults(data, query) {
    try {
      if (!data.shopping_results || !Array.isArray(data.shopping_results)) {
        return [];
      }

      return data.shopping_results.map((item, index) => {
        const currentPrice = this.parseIndianPrice(item.price || '');
        const originalPrice = this.parseIndianPrice(item.price_lower || '');

        let discountPercent = 0;
        if (originalPrice > currentPrice && originalPrice > 0) {
          discountPercent = Math.round(
            ((originalPrice - currentPrice) / originalPrice) * 100
          );
        }

        return {
          id: item.docid || `gshop-${index}-${Date.now()}`,
          title: item.title || `Product for ${query}`,
          productUrl: item.link || null,
          image: item.thumbnail || null,
          currentPrice,
          originalPrice: originalPrice || null,
          discountPercent,
          store: item.source || 'Online Store',
          rating: item.rating || null,
          reviewCount: item.reviews_count || 0,
          inStock: true,
          currency: 'INR',
          searchQuery: query,
          delivery: null
        };
      });
    } catch (error) {
      console.error('Transform error:', error);
      return [];
    }
  }

  extractTotalResults(data) {
    try {
      if (data.shopping_results && Array.isArray(data.shopping_results)) {
        if (data.pagination && data.pagination.pages_count > 1) {
          return data.shopping_results.length * data.pagination.pages_count;
        }
        return data.shopping_results.length;
      }
      return 0;
    } catch (error) {
      return 10;
    }
  }

  // ✅ BEST price parser (Indian format safe)
  parseIndianPrice(priceText) {
    if (!priceText) return 0;

    const digits = priceText.replace(/[^\d]/g, '');
    const price = parseInt(digits, 10);

    return isNaN(price) ? 0 : price;
  }
}

module.exports = new ScrapingService();
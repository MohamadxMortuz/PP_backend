const express = require('express');
const router = express.Router();
const productController = require('../controllers/productController');

router.get('/search', productController.searchProducts);
router.get('/trending/searches', productController.getTrendingSearches);
router.get('/trending', productController.getTrendingProducts);
router.get('/:id/price-history', productController.getPriceHistory);
router.get('/:id', productController.getProductById);

module.exports = router;
# DemoCommerce (Static E‑Commerce UI)

Static, animated demo storefront using placeholder images. Includes:

- Home (`index.html`) with hero, featured, categories, newsletter
- All Products (`products.html`) with category filter and sorting
- Product Details (`product.html?id=...`)
- Cart (`cart.html`) with localStorage cart
- Checkout (`checkout.html`) with demo form + order summary
- About (`about.html`) and Contact (`contact.html`)

No real products, orders, or backend. Images are from placehold.co.

## Run

- Easiest: open `index.html` directly (file://) in a browser.
- Or serve locally (recommended) using Python:
  - Windows PowerShell (from this folder):
    ```powershell
    python -m http.server 5173
    ```
    Then open http://localhost:5173

## Structure

- `assets/css/styles.css` – theme, layout, animations
- `assets/js/data.js` – demo catalog data
- `assets/js/app.js` – UI logic, rendering, cart (localStorage)

## Notes

- This is for demo purposes only. No tracking, no external APIs.
- The main attraction (bot) will be integrated next.

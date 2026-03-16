// Cryptocurrency ticker with caching for the tamagotchi display
// NOTE: This file is kept for reference but the inline crypto code in index.html is used

class CryptoTicker {
    constructor() {
        this.priceData = {
            bitcoin: { usd: 0 },
            ethereum: { usd: 0 }
        };
        this.usdBrl = 0;
        this.lastUpdated = null;
        this.updateInterval = 60000; // 1 minute between updates
        this.errorCount = 0;
        
        // DOM elements
        this.btcElement = document.getElementById('btc');
        this.ethElement = document.getElementById('eth');
        this.usdElement = document.getElementById('usd');
        
        // Start the ticker
        this.updatePrices();
    }
    
    formatPrice(price) {
        if (price >= 10000) {
            return '$' + (price / 1000).toFixed(1) + 'k';
        }
        return '$' + price.toLocaleString('en-US', { maximumFractionDigits: 0 });
    }
    
    async updatePrices() {
        try {
            const now = new Date();
            if (this.lastUpdated && (now - this.lastUpdated) < this.updateInterval) {
                setTimeout(() => this.updatePrices(), this.updateInterval);
                return;
            }
            
            // Fetch crypto prices and USD/BRL rate
            const [cryptoRes, fxRes] = await Promise.all([
                fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin,ethereum&vs_currencies=usd'),
                fetch('https://api.coingecko.com/api/v3/simple/price?ids=usd&vs_currencies=brl')
            ]);
            
            if (cryptoRes.ok) {
                const data = await cryptoRes.json();
                this.priceData = data;
                this.errorCount = 0;
            }
            
            if (fxRes.ok) {
                const fxData = await fxRes.json();
                this.usdBrl = fxData.usd?.brl || 0;
            }
            
            this.lastUpdated = now;
            this.updateDisplay();
            
        } catch (error) {
            this.errorCount++;
            console.error('Error in crypto ticker:', error);
        }
        
        const nextInterval = this.errorCount > 0 ? this.updateInterval * 2 : this.updateInterval;
        setTimeout(() => this.updatePrices(), nextInterval);
    }
    
    updateDisplay() {
        if (this.btcElement) {
            this.btcElement.innerText = `BTC ${this.formatPrice(this.priceData.bitcoin?.usd || 0)}`;
        }
        if (this.ethElement) {
            this.ethElement.innerText = `ETH ${this.formatPrice(this.priceData.ethereum?.usd || 0)}`;
        }
        if (this.usdElement && this.usdBrl) {
            this.usdElement.innerText = `USD R$${this.usdBrl.toFixed(2)}`;
        }
    }
}

// NOTE: The inline code in index.html handles crypto updates
// This class is kept for potential modular use

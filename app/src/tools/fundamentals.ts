import { cacheService } from "../services/cache";

// ============================================
// Fundamental Data Types
// ============================================

export interface CompanyProfile {
  symbol: string;
  name: string;
  country: string;
  currency: string;
  exchange: string;
  industry: string;
  sector: string;
  marketCap: number;
  shareOutstanding: number;
  logo: string;
  weburl: string;
}

export interface FinancialMetrics {
  symbol: string;
  // Valuation
  peRatio: number | null;
  pegRatio: number | null;
  pbRatio: number | null;
  psRatio: number | null;
  evToEbitda: number | null;
  evToRevenue: number | null;

  // Profitability
  grossMargin: number | null;
  operatingMargin: number | null;
  netMargin: number | null;
  roe: number | null; // Return on Equity
  roa: number | null; // Return on Assets
  roic: number | null; // Return on Invested Capital

  // Growth
  revenueGrowth: number | null;
  epsGrowth: number | null;
  dividendYield: number | null;

  // Financial Health
  currentRatio: number | null;
  quickRatio: number | null;
  debtToEquity: number | null;
  debtToAssets: number | null;

  // Per Share Data
  eps: number | null;
  bookValuePerShare: number | null;
  revenuePerShare: number | null;
  freeCashFlowPerShare: number | null;

  // Price Targets
  targetHigh: number | null;
  targetLow: number | null;
  targetMean: number | null;
  targetMedian: number | null;
  analystCount: number | null;

  // 52 Week
  high52Week: number | null;
  low52Week: number | null;
  beta: number | null;
}

export interface RecommendationTrend {
  period: string;
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}

export interface FundamentalAnalysis {
  symbol: string;
  profile: CompanyProfile | null;
  metrics: FinancialMetrics;
  recommendations: RecommendationTrend[];
  valuation: {
    rating: "undervalued" | "fair" | "overvalued" | "unknown";
    score: number; // 0-100 (100 = most undervalued)
    reasoning: string[];
  };
  quality: {
    rating: "excellent" | "good" | "fair" | "poor" | "unknown";
    score: number; // 0-100
    reasoning: string[];
  };
  overallRating: "strong_buy" | "buy" | "hold" | "sell" | "strong_sell";
  summary: string;
}

// ============================================
// Fundamentals Tool
// ============================================

export class FundamentalsTool {
  private finnhubApiKey: string | undefined;
  private cacheTimeout = 60 * 60 * 1000; // 1 hour (fundamentals change slowly)

  constructor() {
    this.finnhubApiKey = process.env.FINNHUB_API_KEY;
  }

  /**
   * Get full fundamental analysis for a symbol
   */
  async analyze(symbol: string): Promise<FundamentalAnalysis> {
    const upperSymbol = symbol.toUpperCase();

    // Fetch all data in parallel
    const [profile, metrics, recommendations] = await Promise.all([
      this.getCompanyProfile(upperSymbol),
      this.getFinancialMetrics(upperSymbol),
      this.getRecommendationTrends(upperSymbol),
    ]);

    // Calculate valuation score
    const valuation = this.assessValuation(metrics);

    // Calculate quality score
    const quality = this.assessQuality(metrics);

    // Determine overall rating
    const overallRating = this.calculateOverallRating(
      valuation,
      quality,
      recommendations
    );

    // Generate summary
    const summary = this.generateSummary(
      upperSymbol,
      profile,
      metrics,
      valuation,
      quality,
      overallRating
    );

    return {
      symbol: upperSymbol,
      profile,
      metrics,
      recommendations,
      valuation,
      quality,
      overallRating,
      summary,
    };
  }

  /**
   * Fetch company profile from FinnHub
   */
  async getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
    const cacheKey = `profile:${symbol}`;
    const cached = await cacheService.get<CompanyProfile>(cacheKey);
    if (cached) return cached;

    if (!this.finnhubApiKey) {
      console.warn("FINNHUB_API_KEY not set");
      return null;
    }

    try {
      const url = `https://finnhub.io/api/v1/stock/profile2?symbol=${symbol}&token=${this.finnhubApiKey}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`FinnHub API error: ${response.status}`);
      }

      const data = await response.json();

      if (!data.name) {
        return null; // Invalid symbol
      }

      const profile: CompanyProfile = {
        symbol: data.ticker || symbol,
        name: data.name,
        country: data.country || "Unknown",
        currency: data.currency || "USD",
        exchange: data.exchange || "Unknown",
        industry: data.finnhubIndustry || "Unknown",
        sector: data.finnhubIndustry || "Unknown", // FinnHub doesn't separate sector
        marketCap: data.marketCapitalization || 0,
        shareOutstanding: data.shareOutstanding || 0,
        logo: data.logo || "",
        weburl: data.weburl || "",
      };

      await cacheService.set(cacheKey, profile, this.cacheTimeout);
      return profile;
    } catch (error) {
      console.error(`Failed to fetch profile for ${symbol}:`, error);
      return null;
    }
  }

  /**
   * Fetch financial metrics from FinnHub
   */
  async getFinancialMetrics(symbol: string): Promise<FinancialMetrics> {
    const cacheKey = `metrics:${symbol}`;
    const cached = await cacheService.get<FinancialMetrics>(cacheKey);
    if (cached) return cached;

    const defaultMetrics: FinancialMetrics = {
      symbol,
      peRatio: null,
      pegRatio: null,
      pbRatio: null,
      psRatio: null,
      evToEbitda: null,
      evToRevenue: null,
      grossMargin: null,
      operatingMargin: null,
      netMargin: null,
      roe: null,
      roa: null,
      roic: null,
      revenueGrowth: null,
      epsGrowth: null,
      dividendYield: null,
      currentRatio: null,
      quickRatio: null,
      debtToEquity: null,
      debtToAssets: null,
      eps: null,
      bookValuePerShare: null,
      revenuePerShare: null,
      freeCashFlowPerShare: null,
      targetHigh: null,
      targetLow: null,
      targetMean: null,
      targetMedian: null,
      analystCount: null,
      high52Week: null,
      low52Week: null,
      beta: null,
    };

    if (!this.finnhubApiKey) {
      console.warn("FINNHUB_API_KEY not set");
      return defaultMetrics;
    }

    try {
      const url = `https://finnhub.io/api/v1/stock/metric?symbol=${symbol}&metric=all&token=${this.finnhubApiKey}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`FinnHub API error: ${response.status}`);
      }

      const data = await response.json();
      const m = data.metric || {};

      const metrics: FinancialMetrics = {
        symbol,
        // Valuation
        peRatio: this.parseNumber(m.peBasicExclExtraTTM || m.peNormalizedAnnual),
        pegRatio: this.parseNumber(m.pegRatio),
        pbRatio: this.parseNumber(m.pbQuarterly || m.pbAnnual),
        psRatio: this.parseNumber(m.psQuarterly || m.psTTM),
        evToEbitda: this.parseNumber(m["enterpriseValue/ebitdaTTM"]),
        evToRevenue: this.parseNumber(m["enterpriseValue/revenueTTM"]),

        // Profitability
        grossMargin: this.parseNumber(m.grossMarginTTM),
        operatingMargin: this.parseNumber(m.operatingMarginTTM),
        netMargin: this.parseNumber(m.netProfitMarginTTM),
        roe: this.parseNumber(m.roeTTM),
        roa: this.parseNumber(m.roaTTM),
        roic: this.parseNumber(m.roicTTM),

        // Growth
        revenueGrowth: this.parseNumber(m.revenueGrowthTTMYoy),
        epsGrowth: this.parseNumber(m.epsGrowthTTMYoy),
        dividendYield: this.parseNumber(m.dividendYieldIndicatedAnnual),

        // Financial Health
        currentRatio: this.parseNumber(m.currentRatioQuarterly),
        quickRatio: this.parseNumber(m.quickRatioQuarterly),
        debtToEquity: this.parseNumber(m.totalDebt2TotalEquityQuarterly),
        debtToAssets: this.parseNumber(m.totalDebt2TotalAssetQuarterly),

        // Per Share Data
        eps: this.parseNumber(m.epsTTM),
        bookValuePerShare: this.parseNumber(m.bookValuePerShareQuarterly),
        revenuePerShare: this.parseNumber(m.revenuePerShareTTM),
        freeCashFlowPerShare: this.parseNumber(m.freeCashFlowPerShareTTM),

        // Price Targets
        targetHigh: this.parseNumber(m.targetHigh),
        targetLow: this.parseNumber(m.targetLow),
        targetMean: this.parseNumber(m.targetMean),
        targetMedian: this.parseNumber(m.targetMedian),
        analystCount: this.parseNumber(m.numberOfAnalysts),

        // 52 Week
        high52Week: this.parseNumber(m["52WeekHigh"]),
        low52Week: this.parseNumber(m["52WeekLow"]),
        beta: this.parseNumber(m.beta),
      };

      await cacheService.set(cacheKey, metrics, this.cacheTimeout);
      return metrics;
    } catch (error) {
      console.error(`Failed to fetch metrics for ${symbol}:`, error);
      return defaultMetrics;
    }
  }

  /**
   * Fetch recommendation trends from FinnHub
   */
  async getRecommendationTrends(symbol: string): Promise<RecommendationTrend[]> {
    const cacheKey = `recommendations:${symbol}`;
    const cached = await cacheService.get<RecommendationTrend[]>(cacheKey);
    if (cached) return cached;

    if (!this.finnhubApiKey) {
      return [];
    }

    try {
      const url = `https://finnhub.io/api/v1/stock/recommendation?symbol=${symbol}&token=${this.finnhubApiKey}`;
      const response = await fetch(url);

      if (!response.ok) {
        throw new Error(`FinnHub API error: ${response.status}`);
      }

      const data = await response.json();

      const recommendations: RecommendationTrend[] = (data || [])
        .slice(0, 4) // Last 4 months
        .map((r: any) => ({
          period: r.period,
          strongBuy: r.strongBuy || 0,
          buy: r.buy || 0,
          hold: r.hold || 0,
          sell: r.sell || 0,
          strongSell: r.strongSell || 0,
        }));

      await cacheService.set(cacheKey, recommendations, this.cacheTimeout);
      return recommendations;
    } catch (error) {
      console.error(`Failed to fetch recommendations for ${symbol}:`, error);
      return [];
    }
  }

  // ============================================
  // Valuation Assessment
  // ============================================

  private assessValuation(metrics: FinancialMetrics): FundamentalAnalysis["valuation"] {
    const reasoning: string[] = [];
    let score = 50; // Start neutral

    // P/E Ratio
    if (metrics.peRatio !== null) {
      if (metrics.peRatio < 0) {
        score -= 15;
        reasoning.push("Negative P/E indicates losses");
      } else if (metrics.peRatio < 15) {
        score += 15;
        reasoning.push(`Low P/E of ${metrics.peRatio.toFixed(1)} suggests value`);
      } else if (metrics.peRatio > 30) {
        score -= 10;
        reasoning.push(`High P/E of ${metrics.peRatio.toFixed(1)} suggests premium pricing`);
      }
    }

    // PEG Ratio
    if (metrics.pegRatio !== null) {
      if (metrics.pegRatio < 1) {
        score += 10;
        reasoning.push(`PEG < 1 (${metrics.pegRatio.toFixed(2)}) indicates undervaluation`);
      } else if (metrics.pegRatio > 2) {
        score -= 10;
        reasoning.push(`PEG > 2 (${metrics.pegRatio.toFixed(2)}) suggests overvaluation`);
      }
    }

    // P/B Ratio
    if (metrics.pbRatio !== null) {
      if (metrics.pbRatio < 1) {
        score += 10;
        reasoning.push(`P/B < 1 (${metrics.pbRatio.toFixed(2)}) trading below book value`);
      } else if (metrics.pbRatio > 5) {
        score -= 5;
        reasoning.push(`High P/B of ${metrics.pbRatio.toFixed(2)}`);
      }
    }

    // EV/EBITDA
    if (metrics.evToEbitda !== null) {
      if (metrics.evToEbitda < 8) {
        score += 10;
        reasoning.push(`Low EV/EBITDA of ${metrics.evToEbitda.toFixed(1)}`);
      } else if (metrics.evToEbitda > 15) {
        score -= 5;
        reasoning.push(`High EV/EBITDA of ${metrics.evToEbitda.toFixed(1)}`);
      }
    }

    // Analyst targets
    if (metrics.targetMean !== null && metrics.high52Week !== null) {
      const currentVsTarget = ((metrics.targetMean - metrics.high52Week) / metrics.high52Week) * 100;
      if (currentVsTarget > 20) {
        score += 10;
        reasoning.push(`Analysts see ${currentVsTarget.toFixed(0)}% upside`);
      }
    }

    // Clamp score
    score = Math.max(0, Math.min(100, score));

    // Determine rating
    let rating: FundamentalAnalysis["valuation"]["rating"];
    if (score >= 65) {
      rating = "undervalued";
    } else if (score >= 35) {
      rating = "fair";
    } else if (score > 0) {
      rating = "overvalued";
    } else {
      rating = "unknown";
    }

    return { rating, score, reasoning };
  }

  // ============================================
  // Quality Assessment
  // ============================================

  private assessQuality(metrics: FinancialMetrics): FundamentalAnalysis["quality"] {
    const reasoning: string[] = [];
    let score = 50;

    // Profitability
    if (metrics.netMargin !== null) {
      if (metrics.netMargin > 20) {
        score += 15;
        reasoning.push(`Strong net margin of ${metrics.netMargin.toFixed(1)}%`);
      } else if (metrics.netMargin > 10) {
        score += 5;
        reasoning.push(`Healthy net margin of ${metrics.netMargin.toFixed(1)}%`);
      } else if (metrics.netMargin < 0) {
        score -= 15;
        reasoning.push("Negative profitability");
      }
    }

    // ROE
    if (metrics.roe !== null) {
      if (metrics.roe > 20) {
        score += 15;
        reasoning.push(`Excellent ROE of ${metrics.roe.toFixed(1)}%`);
      } else if (metrics.roe > 15) {
        score += 10;
        reasoning.push(`Good ROE of ${metrics.roe.toFixed(1)}%`);
      } else if (metrics.roe < 5 && metrics.roe > 0) {
        score -= 5;
        reasoning.push(`Weak ROE of ${metrics.roe.toFixed(1)}%`);
      } else if (metrics.roe < 0) {
        score -= 10;
        reasoning.push("Negative ROE");
      }
    }

    // Financial Health
    if (metrics.currentRatio !== null) {
      if (metrics.currentRatio > 2) {
        score += 10;
        reasoning.push(`Strong liquidity (current ratio: ${metrics.currentRatio.toFixed(1)})`);
      } else if (metrics.currentRatio < 1) {
        score -= 10;
        reasoning.push(`Liquidity concerns (current ratio: ${metrics.currentRatio.toFixed(1)})`);
      }
    }

    // Debt
    if (metrics.debtToEquity !== null) {
      if (metrics.debtToEquity < 0.5) {
        score += 10;
        reasoning.push(`Low debt (D/E: ${metrics.debtToEquity.toFixed(2)})`);
      } else if (metrics.debtToEquity > 2) {
        score -= 10;
        reasoning.push(`High debt (D/E: ${metrics.debtToEquity.toFixed(2)})`);
      }
    }

    // Growth
    if (metrics.revenueGrowth !== null) {
      if (metrics.revenueGrowth > 20) {
        score += 10;
        reasoning.push(`Strong revenue growth of ${metrics.revenueGrowth.toFixed(1)}%`);
      } else if (metrics.revenueGrowth < -10) {
        score -= 10;
        reasoning.push(`Revenue declining ${Math.abs(metrics.revenueGrowth).toFixed(1)}%`);
      }
    }

    // Clamp score
    score = Math.max(0, Math.min(100, score));

    // Determine rating
    let rating: FundamentalAnalysis["quality"]["rating"];
    if (score >= 75) {
      rating = "excellent";
    } else if (score >= 60) {
      rating = "good";
    } else if (score >= 40) {
      rating = "fair";
    } else if (score > 0) {
      rating = "poor";
    } else {
      rating = "unknown";
    }

    return { rating, score, reasoning };
  }

  // ============================================
  // Overall Rating
  // ============================================

  private calculateOverallRating(
    valuation: FundamentalAnalysis["valuation"],
    quality: FundamentalAnalysis["quality"],
    recommendations: RecommendationTrend[]
  ): FundamentalAnalysis["overallRating"] {
    // Weight: 40% valuation, 40% quality, 20% analyst consensus
    let score = valuation.score * 0.4 + quality.score * 0.4;

    // Factor in analyst recommendations
    if (recommendations.length > 0) {
      const latest = recommendations[0];
      const total =
        latest.strongBuy + latest.buy + latest.hold + latest.sell + latest.strongSell;

      if (total > 0) {
        const bullishPercent = ((latest.strongBuy + latest.buy) / total) * 100;
        const bearishPercent = ((latest.sell + latest.strongSell) / total) * 100;

        if (bullishPercent > 70) {
          score += 15;
        } else if (bullishPercent > 50) {
          score += 5;
        } else if (bearishPercent > 50) {
          score -= 10;
        }
      }
    }

    // Clamp
    score = Math.max(0, Math.min(100, score));

    // Convert to rating
    if (score >= 75) return "strong_buy";
    if (score >= 60) return "buy";
    if (score >= 40) return "hold";
    if (score >= 25) return "sell";
    return "strong_sell";
  }

  // ============================================
  // Summary Generation
  // ============================================

  private generateSummary(
    symbol: string,
    profile: CompanyProfile | null,
    metrics: FinancialMetrics,
    valuation: FundamentalAnalysis["valuation"],
    quality: FundamentalAnalysis["quality"],
    rating: FundamentalAnalysis["overallRating"]
  ): string {
    const lines: string[] = [];

    // Company info
    if (profile) {
      lines.push(
        `${profile.name} (${symbol}) is a ${profile.industry} company ` +
          `with a market cap of $${(profile.marketCap / 1000).toFixed(1)}B.`
      );
    }

    // Valuation assessment
    lines.push(
      `Valuation: ${valuation.rating.toUpperCase()} (score: ${valuation.score}/100). ` +
        valuation.reasoning.slice(0, 2).join(". ") +
        "."
    );

    // Quality assessment
    lines.push(
      `Quality: ${quality.rating.toUpperCase()} (score: ${quality.score}/100). ` +
        quality.reasoning.slice(0, 2).join(". ") +
        "."
    );

    // Key metrics
    const keyMetrics: string[] = [];
    if (metrics.peRatio !== null) keyMetrics.push(`P/E: ${metrics.peRatio.toFixed(1)}`);
    if (metrics.roe !== null) keyMetrics.push(`ROE: ${metrics.roe.toFixed(1)}%`);
    if (metrics.debtToEquity !== null)
      keyMetrics.push(`D/E: ${metrics.debtToEquity.toFixed(2)}`);
    if (metrics.revenueGrowth !== null)
      keyMetrics.push(`Rev Growth: ${metrics.revenueGrowth.toFixed(1)}%`);

    if (keyMetrics.length > 0) {
      lines.push(`Key metrics: ${keyMetrics.join(", ")}.`);
    }

    // Overall rating
    const ratingText = rating.replace("_", " ").toUpperCase();
    lines.push(`Overall fundamental rating: ${ratingText}.`);

    return lines.join(" ");
  }

  // ============================================
  // Helpers
  // ============================================

  private parseNumber(value: any): number | null {
    if (value === null || value === undefined || value === "") return null;
    const num = Number(value);
    return isNaN(num) ? null : num;
  }
}

// Export singleton
export const fundamentalsTool = new FundamentalsTool();

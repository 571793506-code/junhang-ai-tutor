const API_BASE_STORAGE_KEY = "junhang_api_base_url";
const DEFAULT_API_BASE_URL = "http://127.0.0.1:8787";

function normalizeApiBaseUrl(value) {
  return String(value || "").trim().replace(/\/$/, "");
}

App({
  globalData: {
    apiBaseUrl: DEFAULT_API_BASE_URL
  },
  onLaunch() {
    const storedApiBaseUrl = normalizeApiBaseUrl(wx.getStorageSync(API_BASE_STORAGE_KEY));
    if (storedApiBaseUrl) {
      this.globalData.apiBaseUrl = storedApiBaseUrl;
    }
  },
  setApiBaseUrl(apiBaseUrl) {
    const normalized = normalizeApiBaseUrl(apiBaseUrl);
    if (!normalized) return;
    wx.setStorageSync(API_BASE_STORAGE_KEY, normalized);
    this.globalData.apiBaseUrl = normalized;
  }
});

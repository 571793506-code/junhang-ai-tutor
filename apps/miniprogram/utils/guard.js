const api = require("./api");
const session = require("./session");

function loginUrl(role) {
  if (role === "teacher") return "/pages/role/index?role=teacher";
  if (role === "classroom") return "/pages/role/index?role=classroom";
  return "/pages/role/index?role=student";
}

function cachedIdentity(role) {
  if (role === "teacher") return session.getTeacher();
  if (role === "classroom") return session.getDevice();
  return session.getStudent();
}

async function requireRole(role, page) {
  const identity = cachedIdentity(role);
  const token = session.getToken();
  if (!identity || !token) {
    session.clearAll();
    wx.redirectTo({ url: loginUrl(role) });
    return null;
  }
  try {
    const response = await api.verifySession();
    if (!response.session || response.session.role !== role) {
      throw new Error("ROLE_MISMATCH");
    }
    return identity;
  } catch (error) {
    session.clearAll();
    if (page && page.setData) {
      page.setData({ message: "登录状态已失效，请重新登录。" });
    }
    wx.redirectTo({ url: loginUrl(role) });
    return null;
  }
}

module.exports = {
  requireRole
};

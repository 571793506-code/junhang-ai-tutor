const STUDENT_KEY = "junhang_student_session";
const TEACHER_KEY = "junhang_teacher_session";
const TOKEN_KEY = "junhang_session_token";
const DEVICE_KEY = "junhang_classroom_device";

function getStudent() {
  return wx.getStorageSync(STUDENT_KEY) || null;
}

function setStudent(student) {
  wx.setStorageSync(STUDENT_KEY, student);
}

function clearStudent() {
  wx.removeStorageSync(STUDENT_KEY);
  wx.removeStorageSync(TOKEN_KEY);
}

function getTeacher() {
  return wx.getStorageSync(TEACHER_KEY) || null;
}

function setTeacher(teacher) {
  wx.setStorageSync(TEACHER_KEY, teacher);
}

function clearTeacher() {
  wx.removeStorageSync(TEACHER_KEY);
  wx.removeStorageSync(TOKEN_KEY);
}

function getToken() {
  return wx.getStorageSync(TOKEN_KEY) || "";
}

function setToken(token) {
  if (token) wx.setStorageSync(TOKEN_KEY, token);
}

function clearToken() {
  wx.removeStorageSync(TOKEN_KEY);
}

function getDevice() {
  return wx.getStorageSync(DEVICE_KEY) || null;
}

function setDevice(device) {
  wx.setStorageSync(DEVICE_KEY, device);
}

function clearDevice() {
  wx.removeStorageSync(DEVICE_KEY);
}

function clearAll() {
  clearStudent();
  clearTeacher();
  clearDevice();
  clearToken();
}

module.exports = {
  clearAll,
  clearDevice,
  clearStudent,
  clearTeacher,
  clearToken,
  getDevice,
  getStudent,
  getTeacher,
  getToken,
  setDevice,
  setStudent,
  setTeacher,
  setToken
};

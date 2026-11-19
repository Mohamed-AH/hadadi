/* Who may do what (owner 2026-11-18, phase C folded in): super admin > admin > editor.
   super: everything, incl. managing admins and the audit log. admin: content, messages, live layer, layout, statistics, reports,
   and adding/stopping editors. editor: content only. Changing a permission = one line here + a test update. */
const EDITOR = ["view", "content.edit", "content.hide", "content.publish"];
const ADMIN = [...EDITOR, "messages.view", "messages.edit", "banners.edit", "announcements.edit", "schedule.edit", "layout.edit", "analytics.view", "reports.view", "users.editors"];
const MATRIX = { super: [...ADMIN, "users.manage", "audit.view", "settings.edit"], admin: ADMIN, editor: EDITOR };
export const ROLES = Object.keys(MATRIX);
export const can = (role, action) => !!MATRIX[role] && MATRIX[role].includes(action);
export const ROLE_AR = { super: "مدير عام", admin: "مدير", editor: "محرر" };
/* which roles a user may give or take away: super = all, admin = editors only */
export const manageable = role => can(role, "users.manage") ? ROLES : can(role, "users.editors") ? ["editor"] : [];

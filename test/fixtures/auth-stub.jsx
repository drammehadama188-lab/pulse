// Stand-in for AuthContext so pages can be rendered outside a browser with a
// known signed-in user. Test-only.
const user = {
  username: 'adama', name: 'Adama Damia', title: 'Founder / CEO', department: 'Leadership',
  powers: ['hr', 'payroll', 'team', 'approvals', 'staffadmin', 'performance'], isTeamLead: false,
}
export function useAuth() {
  return {
    user, realUser: user, loading: false, impersonating: false, ownerActing: false,
    isManager: true, hasPower: () => true, logout() {}, exitViewAs() {}, isViewAs: false,
  }
}
export function AuthProvider({ children }) { return children }

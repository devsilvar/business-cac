import bcrypt from 'bcrypt';

export interface AdminConfigState {
  email: string;
  passwordHash: string;
}

let state: AdminConfigState = {
  email: process.env.ADMIN_EMAIL || 'admin@yourcompany.com',
  passwordHash: ''
};

export const AdminConfigStore = {
  get(): AdminConfigState {
    return state;
  },
  async setEmailAndPassword(email: string, plainPassword: string) {
    state = {
      email,
      passwordHash: await bcrypt.hash(plainPassword, 12)
    };
  },
  setHashed(email: string, passwordHash: string) {
    state = { email, passwordHash };
  }
};

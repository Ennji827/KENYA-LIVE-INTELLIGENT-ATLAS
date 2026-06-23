import React, { useEffect, useState } from "react";
import { UserPlus, Users } from "lucide-react";
import { getApiBase } from "../utils/api";

const roles = [
  "ministry",
  "analyst",
  "county",
  "field_officer",
  "farmer",
  "auditor",
];

export default function UserManagementPanel({ session }) {
  const [users, setUsers] = useState([]);
  const [message, setMessage] = useState("Loading AEIS-K users...");
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({
    username: "",
    email: "",
    password: "",
    role: "field_officer",
    county_name: "",
    first_name: "",
    last_name: "",
  });

  const headers = {
    Authorization: `Bearer ${session?.token || ""}`,
    "Content-Type": "application/json",
  };

  const loadUsers = async () => {
    try {
      const response = await fetch(`${getApiBase()}/api/users?page_size=100`, {
        headers: { Authorization: headers.Authorization },
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "User registry unavailable.");
      setUsers(payload.results || []);
      setMessage(`${payload.pagination?.total || 0} role-based accounts registered.`);
    } catch (error) {
      setMessage(error.message);
    }
  };

  useEffect(() => {
    loadUsers();
  }, [session?.token]);

  const createUser = async (event) => {
    event.preventDefault();
    setMessage("Creating secure role account...");
    const response = await fetch(`${getApiBase()}/api/users`, {
      method: "POST",
      headers,
      body: JSON.stringify(form),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error || "Unable to create user.");
      return;
    }
    setForm({
      username: "",
      email: "",
      password: "",
      role: "field_officer",
      county_name: "",
      first_name: "",
      last_name: "",
    });
    setShowForm(false);
    setMessage(`${payload.user.email} created.`);
    loadUsers();
  };

  const toggleUser = async (user) => {
    const response = await fetch(`${getApiBase()}/api/users/${user.id}`, {
      method: "PATCH",
      headers,
      body: JSON.stringify({ is_active: !user.is_active }),
    });
    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error || "Unable to update user.");
      return;
    }
    setMessage(`${payload.user.email} is now ${payload.user.is_active ? "active" : "disabled"}.`);
    loadUsers();
  };

  return (
    <section className="aeis-card aeis-card-pad aeis-user-manager">
      <div className="aeis-card-heading">
        <div>
          <h2 className="aeis-section-title"><Users size={18} /> Role-based User Management</h2>
          <p className="aeis-section-copy">
            Create Ministry, analyst, county, field officer, farmer, and auditor accounts with enforced scope.
          </p>
        </div>
        <button type="button" className="aeis-btn" onClick={() => setShowForm((value) => !value)}>
          <UserPlus size={16} /> Add user
        </button>
      </div>

      {showForm && (
        <form className="aeis-user-form" onSubmit={createUser}>
          <input required placeholder="First name" value={form.first_name} onChange={(event) => setForm({ ...form, first_name: event.target.value })} />
          <input required placeholder="Last name" value={form.last_name} onChange={(event) => setForm({ ...form, last_name: event.target.value })} />
          <input required placeholder="Username" value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} />
          <input required type="email" placeholder="Email" value={form.email} onChange={(event) => setForm({ ...form, email: event.target.value })} />
          <select value={form.role} onChange={(event) => setForm({ ...form, role: event.target.value })}>
            {roles.map((role) => <option value={role} key={role}>{role.replace("_", " ")}</option>)}
          </select>
          <input
            placeholder="Assigned county (for county/field/farmer)"
            value={form.county_name}
            onChange={(event) => setForm({ ...form, county_name: event.target.value })}
          />
          <input required minLength={8} type="password" placeholder="Temporary password (8+ characters)" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} />
          <button type="submit" className="aeis-btn">Create account</button>
        </form>
      )}

      <p className="aeis-source-note">{message}</p>
      <div className="aeis-table-wrap">
        <table className="aeis-table">
          <thead><tr><th>User</th><th>Role</th><th>Scope</th><th>Status</th><th>Action</th></tr></thead>
          <tbody>
            {users.map((user) => (
              <tr key={user.id}>
                <td><strong>{user.first_name} {user.last_name}</strong><br /><small>{user.email}</small></td>
                <td>{user.role.replace("_", " ")}</td>
                <td>{user.county_name || "National"}</td>
                <td>{user.is_active ? "Active" : "Disabled"}</td>
                <td>
                  <button type="button" className="aeis-table-action" onClick={() => toggleUser(user)}>
                    {user.is_active ? "Disable" : "Enable"}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

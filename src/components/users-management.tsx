import { useState } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { UserPlus, KeyRound, Ban, CheckCircle2 } from "lucide-react";
import {
  listUsersWithRoles,
  createUserWithRole,
  updateUserRole,
  resetUserPassword,
  setUserActive,
} from "@/lib/user-admin.functions";
import type { AppRole } from "@/lib/roles";

const ROLES: AppRole[] = ["admin", "staff", "investor", "moderator"];

export function UsersManagement() {
  const qc = useQueryClient();
  const listFn = useServerFn(listUsersWithRoles);
  const createFn = useServerFn(createUserWithRole);
  const updateRoleFn = useServerFn(updateUserRole);
  const resetFn = useServerFn(resetUserPassword);
  const setActiveFn = useServerFn(setUserActive);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listFn({}),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    fullName: "",
    email: "",
    password: "",
    role: "staff" as AppRole,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  const createMut = useMutation({
    mutationFn: (data: typeof form) => createFn({ data }),
    onSuccess: () => {
      toast.success(`User created (${form.email})`, {
        description: `Temp password: ${form.password}`,
      });
      setOpen(false);
      setForm({ fullName: "", email: "", password: "", role: "staff" });
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to create user"),
  });

  const updateRoleMut = useMutation({
    mutationFn: (v: { userId: string; role: AppRole }) => updateRoleFn({ data: v }),
    onSuccess: () => {
      toast.success("Role updated");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed to update role"),
  });

  const setActiveMut = useMutation({
    mutationFn: (v: { userId: string; active: boolean }) => setActiveFn({ data: v }),
    onSuccess: (_, v) => {
      toast.success(v.active ? "User reactivated" : "User deactivated");
      invalidate();
    },
    onError: (e: any) => toast.error(e?.message ?? "Failed"),
  });

  const resetPw = async (email: string) => {
    try {
      await resetFn({ data: { email } });
      toast.success(`Password reset link sent to ${email}`);
    } catch (e: any) {
      toast.error(e?.message ?? "Failed");
    }
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardTitle className="text-base">Users</CardTitle>
        <Dialog open={open} onOpenChange={setOpen}>
          <DialogTrigger asChild>
            <Button size="sm">
              <UserPlus className="mr-2 h-4 w-4" />
              Add User
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Add User</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Full Name</Label>
                <Input
                  value={form.fullName}
                  onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm({ ...form, email: e.target.value })}
                />
              </div>
              <div>
                <Label>Temporary Password</Label>
                <Input
                  type="text"
                  value={form.password}
                  onChange={(e) => setForm({ ...form, password: e.target.value })}
                  placeholder="min 8 characters"
                />
              </div>
              <div>
                <Label>Role</Label>
                <Select
                  value={form.role}
                  onValueChange={(v) => setForm({ ...form, role: v as AppRole })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {ROLES.map((r) => (
                      <SelectItem key={r} value={r}>
                        {r}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <DialogFooter>
              <Button
                disabled={
                  createMut.isPending || !form.fullName || !form.email || form.password.length < 8
                }
                onClick={() => createMut.mutate(form)}
              >
                {createMut.isPending ? "Creating…" : "Create User"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Created</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {(users as any[]).map((u) => {
                const currentRole = (u.roles?.[0] ?? "staff") as AppRole;
                return (
                  <TableRow key={u.id}>
                    <TableCell className="font-medium">{u.full_name || "—"}</TableCell>
                    <TableCell className="text-muted-foreground">{u.email}</TableCell>
                    <TableCell>
                      <Select
                        value={currentRole}
                        onValueChange={(v) =>
                          updateRoleMut.mutate({ userId: u.id, role: v as AppRole })
                        }
                      >
                        <SelectTrigger className="h-8 w-32">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {ROLES.map((r) => (
                            <SelectItem key={r} value={r}>
                              {r}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                    <TableCell>
                      {u.is_active === false ? (
                        <Badge variant="destructive">Inactive</Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-500/50 text-emerald-500">
                          Active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {u.created_at ? new Date(u.created_at).toLocaleDateString() : "—"}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => resetPw(u.email)}
                        title="Send reset link"
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setActiveMut.mutate({ userId: u.id, active: u.is_active === false })
                        }
                        title={u.is_active === false ? "Reactivate" : "Deactivate"}
                      >
                        {u.is_active === false ? (
                          <CheckCircle2 className="h-4 w-4" />
                        ) : (
                          <Ban className="h-4 w-4" />
                        )}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        )}
      </CardContent>
    </Card>
  );
}

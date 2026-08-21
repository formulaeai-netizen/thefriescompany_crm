import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Ban, CheckCircle2, KeyRound, Settings2, UserPlus } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { INTERNAL_USER_ROLES, USER_CREATION_ROLES } from "@/lib/customer-portal-admin";
import type { AppRole } from "@/lib/roles";
import {
  createUserWithRole,
  listCustomerPortalOptions,
  listUsersWithRoles,
  resetUserPassword,
  setUserActive,
  updateCustomerPortalAccess,
  updateUserRole,
} from "@/lib/user-admin.functions";

type PortalClient = {
  id: string;
  legal_name: string;
  branches: Array<{ id: string; client_id: string; branch_name: string; city?: string | null }>;
};

type PortalEdit = {
  userId: string;
  email: string;
  clientId: string;
  clientLocked: boolean;
  branchIds: string[];
  active: boolean;
};

const emptyForm = {
  fullName: "",
  email: "",
  password: "",
  role: "staff" as AppRole,
  clientId: "",
  branchIds: [] as string[],
};

function BranchMultiSelect({
  branches,
  selected,
  onChange,
}: {
  branches: PortalClient["branches"];
  selected: string[];
  onChange: (branchIds: string[]) => void;
}) {
  if (branches.length === 0) {
    return <p className="text-sm text-muted-foreground">This client has no branches.</p>;
  }
  return (
    <div className="max-h-44 space-y-2 overflow-y-auto rounded-md border p-3">
      {branches.map((branch) => {
        const checked = selected.includes(branch.id);
        return (
          <label key={branch.id} className="flex cursor-pointer items-center gap-2 text-sm">
            <Checkbox
              checked={checked}
              onCheckedChange={(next) =>
                onChange(
                  next
                    ? [...selected, branch.id]
                    : selected.filter((branchId) => branchId !== branch.id),
                )
              }
            />
            <span>
              {branch.branch_name}
              {branch.city ? ` - ${branch.city}` : ""}
            </span>
          </label>
        );
      })}
    </div>
  );
}

export function UsersManagement() {
  const qc = useQueryClient();
  const listFn = useServerFn(listUsersWithRoles);
  const createFn = useServerFn(createUserWithRole);
  const updateRoleFn = useServerFn(updateUserRole);
  const resetFn = useServerFn(resetUserPassword);
  const setActiveFn = useServerFn(setUserActive);
  const portalOptionsFn = useServerFn(listCustomerPortalOptions);
  const updatePortalFn = useServerFn(updateCustomerPortalAccess);

  const { data: users = [], isLoading } = useQuery({
    queryKey: ["admin-users"],
    queryFn: () => listFn({}),
  });
  const { data: portalClients = [] } = useQuery({
    queryKey: ["customer-portal-options"],
    queryFn: () => portalOptionsFn({}),
  });

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [portalEdit, setPortalEdit] = useState<PortalEdit | null>(null);

  const invalidate = () => qc.invalidateQueries({ queryKey: ["admin-users"] });

  const createMut = useMutation({
    mutationFn: (data: typeof form) =>
      createFn({ data: { ...data, clientId: data.clientId || null } }),
    onSuccess: () => {
      toast.success(`User created (${form.email})`, {
        description: `Temp password: ${form.password}`,
      });
      setOpen(false);
      setForm(emptyForm);
      invalidate();
    },
    onError: (error: any) => toast.error(error?.message ?? "Failed to create user"),
  });

  const updateRoleMut = useMutation({
    mutationFn: (value: { userId: string; role: (typeof INTERNAL_USER_ROLES)[number] }) =>
      updateRoleFn({ data: value }),
    onSuccess: () => {
      toast.success("Role updated");
      invalidate();
    },
    onError: (error: any) => toast.error(error?.message ?? "Failed to update role"),
  });

  const setActiveMut = useMutation({
    mutationFn: (value: { userId: string; active: boolean }) => setActiveFn({ data: value }),
    onSuccess: (_, value) => {
      toast.success(value.active ? "User reactivated" : "User deactivated");
      invalidate();
    },
    onError: (error: any) => toast.error(error?.message ?? "Failed"),
  });

  const updatePortalMut = useMutation({
    mutationFn: (data: PortalEdit) =>
      updatePortalFn({
        data: {
          userId: data.userId,
          clientId: data.clientId || null,
          branchIds: data.branchIds,
          active: data.active,
        },
      }),
    onSuccess: () => {
      toast.success("Portal access updated");
      setPortalEdit(null);
      invalidate();
    },
    onError: (error: any) => toast.error(error?.message ?? "Failed to update portal access"),
  });

  const resetPassword = async (email: string) => {
    try {
      await resetFn({ data: { email } });
      toast.success(`Password reset link sent to ${email}`);
    } catch (error: any) {
      toast.error(error?.message ?? "Failed");
    }
  };

  const clients = portalClients as PortalClient[];
  const createClient = clients.find((client) => client.id === form.clientId);
  const editClient = clients.find((client) => client.id === portalEdit?.clientId);
  const customerFormInvalid =
    form.role === "customer" && (!form.clientId || form.branchIds.length === 0);

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
          <DialogContent className="max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Add User</DialogTitle>
            </DialogHeader>
            <div className="space-y-3">
              <div>
                <Label>Full Name</Label>
                <Input
                  value={form.fullName}
                  onChange={(event) => setForm({ ...form, fullName: event.target.value })}
                />
              </div>
              <div>
                <Label>Email</Label>
                <Input
                  type="email"
                  value={form.email}
                  onChange={(event) => setForm({ ...form, email: event.target.value })}
                />
              </div>
              <div>
                <Label>Temporary Password</Label>
                <Input
                  type="text"
                  value={form.password}
                  onChange={(event) => setForm({ ...form, password: event.target.value })}
                  placeholder="min 8 characters"
                />
              </div>
              <div>
                <Label>Role</Label>
                <Select
                  value={form.role}
                  onValueChange={(role) =>
                    setForm({
                      ...form,
                      role: role as AppRole,
                      clientId: role === "customer" ? form.clientId : "",
                      branchIds: role === "customer" ? form.branchIds : [],
                    })
                  }
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {USER_CREATION_ROLES.map((role) => (
                      <SelectItem key={role} value={role}>
                        {role}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {form.role === "customer" && (
                <div className="space-y-3 rounded-md border p-3">
                  <div>
                    <Label>Customer / Client</Label>
                    <Select
                      value={form.clientId}
                      onValueChange={(clientId) => setForm({ ...form, clientId, branchIds: [] })}
                    >
                      <SelectTrigger>
                        <SelectValue placeholder="Select client" />
                      </SelectTrigger>
                      <SelectContent>
                        {clients.map((client) => (
                          <SelectItem key={client.id} value={client.id}>
                            {client.legal_name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <Label>Allowed Branches</Label>
                    <BranchMultiSelect
                      branches={createClient?.branches ?? []}
                      selected={form.branchIds}
                      onChange={(branchIds) => setForm({ ...form, branchIds })}
                    />
                  </div>
                </div>
              )}
            </div>
            <DialogFooter>
              <Button
                disabled={
                  createMut.isPending ||
                  !form.fullName ||
                  !form.email ||
                  form.password.length < 8 ||
                  customerFormInvalid
                }
                onClick={() => createMut.mutate(form)}
              >
                {createMut.isPending ? "Creating..." : "Create User"}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Loading...</p>
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
              {(users as any[]).map((user) => {
                const currentRole = (user.roles?.[0] ?? "staff") as AppRole;
                return (
                  <TableRow key={user.id}>
                    <TableCell className="font-medium">{user.full_name || "-"}</TableCell>
                    <TableCell className="text-muted-foreground">{user.email}</TableCell>
                    <TableCell>
                      {currentRole === "customer" ? (
                        <Badge variant="outline">customer</Badge>
                      ) : (
                        <Select
                          value={currentRole}
                          onValueChange={(role) =>
                            updateRoleMut.mutate({
                              userId: user.id,
                              role: role as (typeof INTERNAL_USER_ROLES)[number],
                            })
                          }
                        >
                          <SelectTrigger className="h-8 w-32">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {INTERNAL_USER_ROLES.map((role) => (
                              <SelectItem key={role} value={role}>
                                {role}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      )}
                    </TableCell>
                    <TableCell>
                      {user.is_active === false ? (
                        <Badge variant="destructive">Inactive</Badge>
                      ) : currentRole === "customer" && user.portalAccess?.active === false ? (
                        <Badge variant="secondary">Portal disabled</Badge>
                      ) : (
                        <Badge variant="outline" className="border-emerald-500/50 text-emerald-500">
                          Active
                        </Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {user.created_at ? new Date(user.created_at).toLocaleDateString() : "-"}
                    </TableCell>
                    <TableCell className="text-right">
                      {currentRole === "customer" && (
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() =>
                            setPortalEdit({
                              userId: user.id,
                              email: user.email,
                              clientId: user.portalAccess?.clientId ?? "",
                              clientLocked: Boolean(user.portalAccess?.clientId),
                              branchIds: user.portalAccess?.branchIds ?? [],
                              active: user.portalAccess?.active ?? true,
                            })
                          }
                          title="Edit portal access"
                        >
                          <Settings2 className="mr-1 h-4 w-4" />
                          Portal Access
                        </Button>
                      )}
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => resetPassword(user.email)}
                        title="Send reset link"
                      >
                        <KeyRound className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() =>
                          setActiveMut.mutate({
                            userId: user.id,
                            active: user.is_active === false,
                          })
                        }
                        title={user.is_active === false ? "Reactivate" : "Deactivate"}
                      >
                        {user.is_active === false ? (
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

      <Dialog open={Boolean(portalEdit)} onOpenChange={(next) => !next && setPortalEdit(null)}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Portal Access</DialogTitle>
          </DialogHeader>
          {portalEdit && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">{portalEdit.email}</p>
              <div>
                <Label>Customer / Client</Label>
                <Select
                  value={portalEdit.clientId}
                  disabled={portalEdit.clientLocked}
                  onValueChange={(clientId) =>
                    setPortalEdit({ ...portalEdit, clientId, branchIds: [] })
                  }
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Select client" />
                  </SelectTrigger>
                  <SelectContent>
                    {clients.map((client) => (
                      <SelectItem key={client.id} value={client.id}>
                        {client.legal_name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label>Allowed Branches</Label>
                <BranchMultiSelect
                  branches={editClient?.branches ?? []}
                  selected={portalEdit.branchIds}
                  onChange={(branchIds) => setPortalEdit({ ...portalEdit, branchIds })}
                />
              </div>
              <div className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="text-sm font-medium">Portal access</div>
                  <div className="text-xs text-muted-foreground">
                    Disabling keeps the user and business history intact.
                  </div>
                </div>
                <Switch
                  checked={portalEdit.active}
                  onCheckedChange={(active) => setPortalEdit({ ...portalEdit, active })}
                />
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setPortalEdit(null)}>
              Cancel
            </Button>
            <Button
              disabled={
                !portalEdit ||
                updatePortalMut.isPending ||
                !portalEdit.clientId ||
                (portalEdit.active && portalEdit.branchIds.length === 0)
              }
              onClick={() => portalEdit && updatePortalMut.mutate(portalEdit)}
            >
              {updatePortalMut.isPending ? "Saving..." : "Save Portal Access"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

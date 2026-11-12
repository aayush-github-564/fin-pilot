import { zodResolver } from "@hookform/resolvers/zod";
import { Layers3, Pencil, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { z } from "zod";

import { ApiError } from "../../api/errors";
import { Badge } from "../../components/ui/badge";
import { Button } from "../../components/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "../../components/ui/card";
import { ErrorMessage, LoadingState } from "../../components/ui/feedback";
import { Input } from "../../components/ui/input";
import { Select } from "../../components/ui/select";
import { useCompany, useRole } from "../companies/company-context";
import type { Category, CategoryCreate, CategoryKind, CategoryUpdate } from "./api";
import { useCreateCategory, useDeleteCategory, useManagedCategories, useUpdateCategory } from "./hooks";

const categoryFormSchema = z.object({
  name: z.string().trim().min(1, "Enter a category name.").max(100, "Use 100 characters or fewer."),
  kind: z.enum(["expense", "income"]),
  parent_category_id: z.string(),
});

type CategoryFormValues = z.infer<typeof categoryFormSchema>;

function categoryErrorText(error: unknown, fallback: string) {
  if (error instanceof ApiError && error.status === 409) return error.message;
  if (error instanceof ApiError) return error.message;
  return error instanceof Error ? error.message : fallback;
}

function CategoryFields({
  initial,
  categories,
  busy,
  error,
  onCancel,
  onSave,
  submitLabel,
}: {
  initial?: Category;
  categories: Category[];
  busy: boolean;
  error: unknown;
  onCancel?: () => void;
  onSave: (values: CategoryFormValues) => void;
  submitLabel: string;
}) {
  const form = useForm<CategoryFormValues>({
    resolver: zodResolver(categoryFormSchema),
    defaultValues: initial
      ? { name: initial.name, kind: initial.kind, parent_category_id: initial.parent_category_id ?? "" }
      : { name: "", kind: "expense", parent_category_id: "" },
  });
  const kind = useWatch({ control: form.control, name: "kind" });
  const parents = categories.filter((category) => category.kind === kind && category.id !== initial?.id);
  const registerKind = form.register("kind", {
    onChange: (event) => {
      const selectedKind = event.currentTarget.value as CategoryKind;
      const currentParentId = form.getValues("parent_category_id");
      const currentParent = categories.find((category) => category.id === currentParentId);
      if (currentParent && currentParent.kind !== selectedKind) form.setValue("parent_category_id", "");
    },
  });

  return <form className="grid gap-4 sm:grid-cols-2" noValidate onSubmit={form.handleSubmit(onSave)}>
    {error !== null && error !== undefined && <div className="sm:col-span-2"><ErrorMessage>{categoryErrorText(error, "The category could not be saved.")}</ErrorMessage></div>}
    <label className="space-y-1.5 text-sm font-medium text-foreground-body">Name
      <Input autoComplete="off" autoFocus={!initial} maxLength={100} placeholder="e.g. Software" {...form.register("name")} />
      {form.formState.errors.name && <span className="block text-xs text-negative">{form.formState.errors.name.message}</span>}
    </label>
    <label className="space-y-1.5 text-sm font-medium text-foreground-body">Kind
      <Select {...registerKind}><option value="expense">Expense</option><option value="income">Income</option></Select>
    </label>
    <label className="space-y-1.5 text-sm font-medium text-foreground-body sm:col-span-2">Parent category (optional)
      <Select {...form.register("parent_category_id")}><option value="">No parent</option>{parents.map((category) => <option key={category.id} value={category.id}>{category.name}{category.company_id === null ? " · default" : ""}</option>)}</Select>
      <span className="block text-xs font-normal text-muted">A parent must be a default or company category of the same kind.</span>
    </label>
    <div className="flex flex-wrap gap-2 sm:col-span-2">{onCancel && <Button disabled={busy} onClick={onCancel} type="button" variant="secondary">Cancel</Button>}<Button disabled={busy} type="submit">{busy ? "Saving…" : submitLabel}</Button></div>
  </form>;
}

function CategoryCard({ category, categories, parentName, canWrite, companyId }: {
  category: Category;
  categories: Category[];
  parentName: string | null;
  canWrite: boolean;
  companyId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const update = useUpdateCategory(companyId);
  const remove = useDeleteCategory(companyId);
  const isGlobal = category.company_id === null;

  const save = (values: CategoryFormValues) => {
    const body: CategoryUpdate = {
      name: values.name,
      kind: values.kind,
      parent_category_id: values.parent_category_id || null,
    };
    update.mutate({ categoryId: category.id, body }, { onSuccess: () => setEditing(false) });
  };

  return <article className="rounded-lg border border-card-line bg-card p-4">
    {editing ? <>
      <div className="mb-4"><h3 className="font-semibold text-foreground">Edit {category.name}</h3><p className="mt-1 text-xs text-muted">Kind changes can be blocked when linked transactions or child categories would no longer match.</p></div>
      <CategoryFields categories={categories} error={update.error} initial={category} busy={update.isPending} onCancel={() => { setEditing(false); update.reset(); }} onSave={save} submitLabel="Save category" />
    </> : <>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><h3 className="break-words font-semibold text-foreground">{category.name}</h3><Badge variant={category.kind === "expense" ? "neutral" : "info"}>{category.kind}</Badge>{isGlobal && <Badge variant="neutral">Default · read-only</Badge>}</div><p className="mt-1 text-xs text-muted">{parentName ? `Under ${parentName}` : isGlobal ? "Default category shared across companies" : "Company category"}</p></div>
        {canWrite && !isGlobal && <div className="flex gap-1"><Button aria-label={`Edit category ${category.name}`} onClick={() => { setEditing(true); update.reset(); remove.reset(); }} size="icon" title="Edit category" variant="quiet"><Pencil aria-hidden="true" className="size-4" /></Button>{!confirmDelete && <Button aria-label={`Delete category ${category.name}`} onClick={() => { setConfirmDelete(true); remove.reset(); }} size="icon" title="Delete category" variant="quiet"><Trash2 aria-hidden="true" className="size-4 text-negative" /></Button>}</div>}
      </div>
      {canWrite && !isGlobal && confirmDelete && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-negative/40 bg-negative/5 p-3"><p className="text-sm text-negative">Delete this category? Existing transaction or budget references may prevent removal.</p><div className="flex gap-2"><Button disabled={remove.isPending} onClick={() => remove.mutate(category.id, { onSuccess: () => setConfirmDelete(false) })} size="sm" variant="danger">{remove.isPending ? "Deleting…" : "Confirm delete"}</Button><Button disabled={remove.isPending} onClick={() => setConfirmDelete(false)} size="sm" variant="secondary">Cancel</Button></div></div>}
      {update.error && <div className="mt-3"><ErrorMessage>{categoryErrorText(update.error, "The category could not be updated.")}</ErrorMessage></div>}
      {remove.error && <div className="mt-3"><ErrorMessage>{categoryErrorText(remove.error, "The category could not be deleted.")}</ErrorMessage></div>}
    </>}
  </article>;
}

function CompanyCategories({ companyId, canWrite }: { companyId: string; canWrite: boolean }) {
  const categories = useManagedCategories(companyId);
  const create = useCreateCategory(companyId);
  const [showCreate, setShowCreate] = useState(false);
  const data = categories.data ?? [];
  const parentById = new Map(data.map((category) => [category.id, category.name]));
  const defaults = data.filter((category) => category.company_id === null);
  const custom = data.filter((category) => category.company_id !== null);

  const saveNew = (values: CategoryFormValues) => {
    const body: CategoryCreate = {
      name: values.name,
      kind: values.kind,
      parent_category_id: values.parent_category_id || null,
    };
    create.mutate(body, { onSuccess: () => { setShowCreate(false); create.reset(); } });
  };

  return <div className="mx-auto max-w-5xl space-y-6">
    <div className="flex flex-wrap items-end justify-between gap-4"><div><p className="fp-eyebrow">Planning</p><h1 className="fp-page-title mt-2"><em>Categories</em></h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted">Organize transaction and budget reporting with company categories. Default categories are shared and cannot be edited.</p></div>{canWrite && <Button onClick={() => { setShowCreate((current) => !current); create.reset(); }} variant="secondary"><Plus aria-hidden="true" className="size-4" />{showCreate ? "Close form" : "New category"}</Button>}</div>
    {canWrite && showCreate && <Card className="overflow-hidden"><CardHeader className="border-b border-line"><CardTitle>Create a category</CardTitle><CardDescription className="mt-1">Choose whether it classifies money in (income) or money out (expense).</CardDescription></CardHeader><div className="p-5"><CategoryFields categories={data} error={create.error} busy={create.isPending} onCancel={() => { setShowCreate(false); create.reset(); }} onSave={saveNew} submitLabel="Add category" /></div></Card>}
    <Card className="overflow-hidden"><CardHeader className="border-b border-line"><div className="flex flex-wrap items-start justify-between gap-3"><div><CardTitle>Company categories</CardTitle><CardDescription className="mt-1">Only owner and accountant roles can change company categories. Default categories are read-only for everyone.</CardDescription></div><Badge variant="neutral">{categories.data ? `${data.length} categories` : "Loading"}</Badge></div></CardHeader>
      {categories.isPending ? <LoadingState label="Loading categories" /> : categories.isError ? <div className="space-y-3 p-5"><ErrorMessage>{categoryErrorText(categories.error, "Categories could not load.")}</ErrorMessage><Button onClick={() => void categories.refetch()} variant="secondary">Try again</Button></div> : data.length === 0 ? <div className="px-6 py-12 text-center"><Layers3 aria-hidden="true" className="mx-auto size-7 text-muted" /><h2 className="mt-3 font-semibold text-foreground">No categories are available</h2><p className="mt-1 text-sm text-muted">Create a company category or ask an owner to seed the default list.</p></div> : <div className="space-y-6 p-4 sm:p-5">
        <section aria-labelledby="default-categories-heading" className="space-y-3"><div><h2 className="text-base font-semibold text-foreground" id="default-categories-heading">Default categories</h2><p className="mt-1 text-xs text-muted">Shared reference categories; editing is disabled.</p></div>{defaults.length ? defaults.map((category) => <CategoryCard canWrite={false} categories={data} category={category} companyId={companyId} key={category.id} parentName={category.parent_category_id ? parentById.get(category.parent_category_id) ?? null : null} />) : <p className="rounded-md bg-surface-raised p-4 text-sm text-muted">No default categories are available.</p>}</section>
        <section aria-labelledby="custom-categories-heading" className="space-y-3"><div><h2 className="text-base font-semibold text-foreground" id="custom-categories-heading">Your company categories</h2><p className="mt-1 text-xs text-muted">Company categories can be managed by owners and accountants.</p></div>{custom.length ? custom.map((category) => <CategoryCard canWrite={canWrite} categories={data} category={category} companyId={companyId} key={category.id} parentName={category.parent_category_id ? parentById.get(category.parent_category_id) ?? null : null} />) : <p className="rounded-md bg-surface-raised p-4 text-sm text-muted">No company-specific categories have been added.</p>}</section>
      </div>}
    </Card>
  </div>;
}

export function CategoriesPage() {
  const company = useCompany();
  const { canManageCategories: canWrite } = useRole();
  return <CompanyCategories canWrite={canWrite} companyId={company.company_id} key={company.company_id} />;
}

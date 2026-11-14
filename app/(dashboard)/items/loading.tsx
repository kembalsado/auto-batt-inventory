import { PageHeaderSkeleton, TableSkeleton, CardListSkeleton } from "@/components/skeletons";

export default function ItemsLoading() {
  return (
    <div>
      <PageHeaderSkeleton withAction />
      <TableSkeleton columns={5} rows={6} />
      <CardListSkeleton rows={6} />
    </div>
  );
}

// Supabase 連線（化驗紀錄 lab_samples）。
// 只放「專案網址」與「Publishable key」——這兩個本來就是公開給瀏覽器用的；
// 資料安全由資料庫的 RLS 政策把關（任何人可讀取、可新增，不可修改、刪除）。
// 絕對不要把 service_role / sb_secret / 資料庫密碼放進前端。
export const SUPABASE_URL = 'https://ztdumnbolsoajlvhvolz.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_GcsEQXtJQOh7Z-z4ZYcovQ_Exjnmr3X';

// 不透過 npm：執行時從 esm.sh 載入 supabase-js v2（ES module）
const SUPABASE_JS = 'https://esm.sh/@supabase/supabase-js@2';

export interface LabSample {
  id: number;
  created_at: string;
  sampled_at: string;
  plant_id: string;
  unit_id: string;
  param: string;
  value: number | null;
  eng_unit: string | null;
  note: string | null;
}

export type NewLabSample = Omit<LabSample, 'id' | 'created_at'>;

interface QueryResult<T> { data: T | null; error: { message: string } | null }
interface SupabaseLike {
  from(table: string): {
    select(cols: string): {
      eq(col: string, v: string): {
        order(col: string, o: { ascending: boolean }): { limit(n: number): Promise<QueryResult<LabSample[]>> };
      };
    };
    insert(rows: NewLabSample[]): { select(): Promise<QueryResult<LabSample[]>> };
  };
}

let client: Promise<SupabaseLike> | null = null;

export function getSupabase(): Promise<SupabaseLike> {
  if (!client) {
    client = import(/* @vite-ignore */ SUPABASE_JS)
      .then((m: { createClient: (u: string, k: string, o: unknown) => SupabaseLike }) =>
        m.createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, { auth: { persistSession: false } }))
      .catch((e) => { client = null; throw e; });
  }
  return client;
}

export async function listLabSamples(plantId: string): Promise<LabSample[]> {
  const sb = await getSupabase();
  const { data, error } = await sb.from('lab_samples').select('*').eq('plant_id', plantId)
    .order('sampled_at', { ascending: false }).limit(300);
  if (error) throw new Error(error.message);
  return data ?? [];
}

export async function addLabSample(row: NewLabSample): Promise<LabSample> {
  const sb = await getSupabase();
  const { data, error } = await sb.from('lab_samples').insert([row]).select();
  if (error) throw new Error(error.message);
  return (data ?? [])[0];
}

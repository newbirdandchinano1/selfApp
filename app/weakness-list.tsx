import { Redirect } from 'expo-router';

/** @deprecated 缺点已并入「我的技能」页 */
export default function WeaknessListScreen() {
  return <Redirect href="/my-skills" />;
}

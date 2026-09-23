import { Redirect } from 'expo-router';

/** Legacy route: frog assignment now lives on the tasks tab. */
export default function AddFrogRedirect() {
  return <Redirect href="/(tabs)/tasks" />;
}

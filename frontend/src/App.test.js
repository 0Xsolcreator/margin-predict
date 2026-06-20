import { render, screen } from '@testing-library/react';
import App from './App';

test('renders STRIKE hero headline', () => {
  render(<App />);
  expect(screen.getByText(/Strike it\./i)).toBeInTheDocument();
});
